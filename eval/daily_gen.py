#!/usr/bin/env python3
"""daily_gen.py — 일일 자가평가 ① 질문 생성(docs/58 §1).

청크에서 질문 생성(그 청크 = 정답 근거) + 질문은행 누적(중복 차단) + 2축 태깅.
일일 구성: 신규 NEW_N(유형·섹션 쿼터, 미출제 청크 우선) + 회귀 REG_N(오답 open 전건 → 무작위 재검).
출력: eval/daily/<date>.questions.json  (answer→grade→publish가 이어받음)

⛔ 생성 게이트: 질문 숫자는 청크 원문에 실존 · 자문자답(답 포함) 폐기 · 30자 넘는 인용 폐기.
실행: .venv/bin/python eval/daily_gen.py [--date YYYY-MM-DD] [--total N]
"""
import argparse
import datetime
import json
import random
import re
import sys

from daily_common import (BANK, DAILY_DIR, NEW_N, REG_N, REFUSAL_SEEDS, SECTION_QUOTA,
                          TYPE_QUOTA, bigrams, chroma_col, jaccard, llm_json, load_bank,
                          norm_q, qhash, save_bank, topics_of)

GEN_SYS = (
    "너는 사내 규정 챗봇의 품질을 검사할 '시험 문항' 출제자다. 규정/가이드 원문 일부가 주어진다.\n"
    "그 원문만으로 답할 수 있는 실무형 질문 1개를 만들어 다음 JSON만 출력하라:\n"
    '{"질문": "<신입 직원이 물을 법한 자연스러운 한 문장>", "근거문장": "<질문의 정답이 담긴 원문 한 문장을 글자 그대로 복사>"}\n'
    "규칙: ① 원문에 없는 내용을 묻지 마라 ② 질문에 답(수치·결론)을 넣지 마라 "
    "③ 유형 지시를 따르라 — 값형=금액·일수·기한·비율을 묻기 / 절차형=절차·서식·방법 / 조건형=자격·조건·범위 "
    "④ 근거문장은 반드시 원문에서 그대로 복사(요약·의역 금지) — 그 한 문장만 봐도 채점이 되게 "
    "⑤ 정답이 한 문장으로 명확히 존재하지 않으면(모호하면) {\"질문\": \"\"} 출력 — 모호한 출제 금지."
)


def gen_one(doc: str, meta: dict, qtype: str) -> dict | None:
    label = f"{meta.get('규정명','')} {meta.get('조','')}".strip()
    r = llm_json([
        {"role": "system", "content": GEN_SYS},
        {"role": "user", "content": f"유형: {qtype}\n출처: {label}\n원문:\n{doc[:1600]}"},
    ], temperature=0.7, max_tokens=220)
    q = re.sub(r"\s+", " ", str(r.get("질문", ""))).strip()
    if not q or len(q) < 8 or len(q) > 90:
        return None
    src = doc.replace(" ", "")
    # 게이트: 질문 속 숫자는 원문에 실존(환각 질문 차단)
    for tok in re.findall(r"\d+", q):
        if tok not in src:
            return None
    # 골든(근거문장) 게이트: 원문에 실존해야(정규화 2-그램 겹침 80%↑ — 공백차만 허용).
    # 골든을 못 뽑으면 문항 폐기 = 모호한 출제 원천 차단(검토필요 과다의 근본 원인).
    golden = re.sub(r"\s+", " ", str(r.get("근거문장", ""))).strip()
    ng = norm_q(golden)
    if len(ng) < 10:
        return None
    src_n = norm_q(doc)
    gg = {ng[i:i + 2] for i in range(len(ng) - 1)}
    if sum(1 for g in gg if g in src_n) / max(1, len(gg)) < 0.8:
        return None
    # 게이트: 자문자답 — 골든 핵심 값이 질문에 그대로 들어가면 폐기
    for v in re.findall(r"\d[\d,]*\s*(?:원|만원|일|개월|년|주|%|퍼센트)", golden):
        if norm_q(v) in norm_q(q):
            return None
    return {"질문": q, "골든": golden}


def gen_refusal(seed: str, bank_grams: list) -> dict | None:
    r = llm_json([
        {"role": "system", "content":
         '너는 시험 문항 출제자다. 주어진 "사내 규정에 없는 생활 주제"로, 직원이 규정 챗봇에 물을 법한 '
         '자연스러운 질문 1개를 만들어 {"질문": "..."} JSON만 출력하라. 주제 자체를 벗어나지 마라.'},
        {"role": "user", "content": f"주제: {seed}"},
    ], temperature=0.7, max_tokens=100)
    q = re.sub(r"\s+", " ", str(r.get("질문", ""))).strip()
    if not q or len(q) < 8:
        return None
    g = bigrams(q)
    if any(jaccard(g, bg) >= 0.7 for bg in bank_grams):
        return None
    return {"질문": q}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    ap.add_argument("--total", type=int, default=0, help="이번 실행 총 문항(기본 env TOTAL)")
    ap.add_argument("--golden-backfill", action="store_true",
                    help="기존 은행 문항에 골든문장 소급 추출(없는 것만) — 신 채점 로직 적용용")
    ap.add_argument("--sync", action="store_true",
                    help="코퍼스 재색인 후 골든 자가검증 동기화: 재바인딩(청크id 갱신)·stale(개정)·retire(조 삭제)")
    args = ap.parse_args()
    DAILY_DIR.mkdir(exist_ok=True)

    if args.sync:
        # 골든 자가검증(docs/58 §8) — verbatim 골든이 곧 검증 키(별도 그래프 불필요, LLM 0회).
        # ① (규정명,조)의 새 청크에 골든 실존 → 청크id 재바인딩 ② 조는 있는데 골든 소멸 → stale(개정)
        # ③ 조 소멸 → retire. stale은 회귀 풀 제외 + 재생성 대상 목록 출력.
        bank = load_bank()
        col = chroma_col()
        got = col.get(include=["metadatas"])
        by_key: dict = {}
        for i, m in enumerate(got["metadatas"]):
            by_key.setdefault((m.get("규정명", ""), m.get("조", "")), []).append(got["ids"][i])
        rebound = stale = retired = kept = 0
        stale_list = []
        for b in bank:
            src = b.get("출처")
            if not src or b.get("상태") == "retire":
                continue
            key = (src.get("규정명", ""), src.get("조", ""))
            cands = by_key.get(key, [])
            if not cands:
                b["상태"] = "retire"
                b["동기화"] = "조문 소멸(삭제·개정)"
                retired += 1
                continue
            golden = b.get("골든", "")
            if not golden:  # 골든 없는 구형 문항 — 청크 존재만 재바인딩
                if src.get("청크id") not in cands:
                    src["청크id"] = cands[0]
                    rebound += 1
                else:
                    kept += 1
                continue
            ng = norm_q(golden)
            gg = {ng[i:i + 2] for i in range(len(ng) - 1)}
            hit = None
            for cid in cands:
                doc = col.get(ids=[cid], include=["documents"])["documents"][0]
                if sum(1 for x in gg if x in norm_q(doc)) / max(1, len(gg)) >= 0.8:
                    hit = cid
                    break
            if hit:
                if src.get("청크id") != hit:
                    src["청크id"] = hit
                    rebound += 1
                else:
                    kept += 1
                b.pop("동기화", None)
                if b.get("상태") == "stale":
                    b["상태"] = "active"  # 복원(재색인으로 되돌아온 경우)
            else:
                b["상태"] = "stale"  # 개정 의심 — 재출제 후보(회귀 풀 제외)
                b["동기화"] = "골든 소멸(조문 개정 의심)"
                stale += 1
                stale_list.append(f"{key[0]} {key[1]}: {b['질문'][:40]}")
        save_bank(bank)
        print(f"골든 동기화: 유지 {kept} · 재바인딩 {rebound} · stale(개정) {stale} · retire(삭제) {retired}")
        for ln in stale_list[:10]:
            print(f"  ⚠ stale: {ln}")
        return 0

    if args.golden_backfill:
        bank = load_bank()
        col = chroma_col()
        done = fail = skip = 0
        for b in bank:
            if b.get("골든") or not b.get("출처") or b.get("상태") == "retire":
                skip += 1
                continue
            try:
                r = col.get(ids=[b["출처"]["청크id"]], include=["documents"])
                doc = r["documents"][0] if r["documents"] else ""
                if not doc:
                    fail += 1
                    continue
                g = llm_json([
                    {"role": "system", "content":
                     '규정 원문과 질문이 주어진다. 질문의 정답이 담긴 원문 한 문장을 글자 그대로 복사해 '
                     '{"근거문장": "..."} JSON만 출력하라. 명확한 한 문장이 없으면 빈 문자열.'},
                    {"role": "user", "content": f"질문: {b['질문']}\n원문:\n{doc[:1600]}"},
                ], max_tokens=180)
                golden = re.sub(r"\s+", " ", str(g.get("근거문장", ""))).strip()
                ng = norm_q(golden)
                gg = {ng[i:i + 2] for i in range(len(ng) - 1)}
                if len(ng) >= 10 and sum(1 for x in gg if x in norm_q(doc)) / max(1, len(gg)) >= 0.8:
                    b["골든"] = golden
                    done += 1
                else:
                    fail += 1  # 골든 못 뽑음 = 모호 후보(폐기는 채점 재심이 판단)
            except Exception as ex:  # noqa: BLE001
                print(f"  ⚠ {b['id']}: {ex}", file=sys.stderr)
                fail += 1
        save_bank(bank)
        print(f"골든 백필: 성공 {done} · 실패 {fail} · 스킵 {skip}")
        return 0

    bank = load_bank()
    by_hash = {b["hash"]: b for b in bank if "hash" in b}
    bank_grams = [bigrams(b["질문"]) for b in bank]
    # 거부형 문항은 출처가 null — get(k, {})는 값이 None이면 None을 반환하므로 or {} 필수
    # (실측: 2026-07-23 06:00 크론이 여기서 AttributeError로 전량 중단 — 첫 무인 회전 결함)
    used_chunks = {(b.get("출처") or {}).get("청크id") for b in bank}

    new_n = args.total - REG_N if args.total else NEW_N
    reg_n = REG_N

    # ── 회귀 선별: 오답 open 전건 → 부족분은 기존 문항 무작위 재검 ──
    regression = [b for b in bank if b.get("상태") == "open"][:reg_n]
    pool = [b for b in bank if b.get("상태") not in ("open", "retire", "stale")]  # retire=폐기 · stale=개정 대기
    random.shuffle(pool)
    regression += pool[: max(0, reg_n - len(regression))]

    # ── 신규 생성 ──
    n_refusal = round(new_n * TYPE_QUOTA["거부형"])
    n_chunk = new_n - n_refusal
    # 섹션 쿼터로 청크 표본 추출(미출제 우선)
    col = chroma_col()
    got = col.get(include=["metadatas", "documents"])
    idx = list(range(len(got["ids"])))
    random.shuffle(idx)
    by_sec: dict = {k: [] for k in SECTION_QUOTA}
    for i in idx:
        m = got["metadatas"][i]
        sec = m.get("type", "regulation")
        if sec in by_sec and len(got["documents"][i]) >= 200:  # 너무 짧은 청크 제외
            by_sec[sec].append(i)
    for sec in by_sec:  # 미출제 청크 우선
        by_sec[sec].sort(key=lambda i: (got["ids"][i] in used_chunks, random.random()))

    ctypes = (["값형"] * round(n_chunk * 0.45) + ["절차형"] * round(n_chunk * 0.33))
    ctypes += ["조건형"] * (n_chunk - len(ctypes))
    random.shuffle(ctypes)

    new_items, sec_keys = [], list(SECTION_QUOTA)
    sec_take = {s: round(n_chunk * SECTION_QUOTA[s] / sum(SECTION_QUOTA.values())) for s in sec_keys}
    cursor = {s: 0 for s in sec_keys}
    attempts = 0
    while len(new_items) < n_chunk and attempts < n_chunk * 6:
        attempts += 1
        # 남은 쿼터가 큰 섹션부터
        sec = max(sec_keys, key=lambda s: sec_take[s] - sum(1 for it in new_items if it["섹션"] == s))
        lst = by_sec.get(sec) or []
        if cursor[sec] >= len(lst):
            sec_keys = [s for s in sec_keys if s != sec] or list(SECTION_QUOTA)
            continue
        i = lst[cursor[sec]]
        cursor[sec] += 1
        meta, doc, cid = got["metadatas"][i], got["documents"][i], got["ids"][i]
        qtype = ctypes[len(new_items) % len(ctypes)]
        try:
            g = gen_one(doc, meta, qtype)
        except Exception as ex:  # noqa: BLE001
            print(f"  ⚠ 생성 실패 {cid}: {ex}", file=sys.stderr)
            continue
        if not g:
            continue
        h = qhash(g["질문"])
        gr = bigrams(g["질문"])
        if h in by_hash or any(jaccard(gr, bg) >= 0.7 for bg in bank_grams):
            continue  # 중복 — 다른 청크로
        item = {
            "id": f"dq-{args.date}-{len(new_items)+1:03d}", "hash": h, "질문": g["질문"],
            "유형": qtype, "정량여부": qtype == "값형",
            "출처": {"규정명": meta.get("규정명", ""), "조": meta.get("조", ""), "청크id": cid},
            "분류": meta.get("분류", ""), "주제": topics_of(meta.get("규정명", "") + doc[:300]),
            "골든": g.get("골든", ""),
            "생성일": args.date, "상태": "active", "판정이력": [],
        }
        new_items.append({**item, "섹션": meta.get("type", "regulation")})
        by_hash[h] = item
        bank_grams.append(gr)

    # 거부형
    random.shuffle(REFUSAL_SEEDS)
    for seed in REFUSAL_SEEDS:
        if sum(1 for it in new_items if it["유형"] == "거부형") >= n_refusal:
            break
        try:
            g = gen_refusal(seed, bank_grams)
        except Exception as ex:  # noqa: BLE001
            print(f"  ⚠ 거부형 실패 {seed}: {ex}", file=sys.stderr)
            continue
        if not g:
            continue
        h = qhash(g["질문"])
        if h in by_hash:
            continue
        item = {"id": f"dq-{args.date}-r{len(new_items)+1:02d}", "hash": h, "질문": g["질문"],
                "유형": "거부형", "정량여부": False, "출처": None, "분류": "(코퍼스밖)",
                "주제": ["생활·기타"], "생성일": args.date, "상태": "active", "판정이력": []}
        new_items.append({**item, "섹션": "refusal"})
        by_hash[h] = item
        bank_grams.append(bigrams(g["질문"]))

    # 은행 반영(신규만 append — 회귀는 기존 행)
    for it in new_items:
        bank.append({k: v for k, v in it.items() if k != "섹션"})
    save_bank(bank)

    today = [{k: v for k, v in it.items() if k != "섹션"} for it in new_items]
    today += [{**b, "회귀": True} for b in regression]
    out = DAILY_DIR / f"{args.date}.questions.json"
    out.write_text(json.dumps({"date": args.date, "questions": today}, ensure_ascii=False, indent=1),
                   encoding="utf-8")
    from collections import Counter
    print(f"문항 {len(today)} (신규 {len(new_items)} · 회귀 {len(regression)}) → {out}")
    print("  유형:", dict(Counter(q['유형'] for q in today)))
    print("  주제:", dict(Counter(t for q in today for t in q.get('주제', []))))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
