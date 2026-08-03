#!/usr/bin/env python3
"""daily_publish.py — 일일 자가평가 ④⑤ 확정 리포트·웹 공개 데이터·개선 신호(docs/58 §4-6).

- eval/daily/<date>.json           : 확정 리포트(내부, 전체 필드)
- web/public/quality/daily/<date>.json + index.json : 게시판 소비(로그인 뒤 server.js 직서빙,
  재빌드 불필요 — forms-pdf 패턴). 약점 지도(카테고리×유형)·유형별 집계 포함.
- tools/.daily_eval_signals.json   : 검수 큐 신호(원문결함·오답 규정 가중 — review_queue 소비)
- eval/faq_candidates/<date>.md    : '검색실패' 오답의 FAQ 브리지 후보 초안
  (⛔ 답 = 원문 인용 + [[링크]]만 · 볼트 편입은 사람 검수 후 — 자동 편입 금지)
실행: .venv/bin/python eval/daily_publish.py [--date YYYY-MM-DD]
"""
import argparse
import datetime
import json
import re
from collections import Counter, defaultdict
from pathlib import PurePosixPath

from daily_common import DAILY_DIR, FAQ_DIR, ROOT, chroma_col


def build_slug_index():
    """청크id→문서 slug, 규정명→slug 매핑(문서 링크 /d/<slug>/ 해결용).
    slug = 볼트 파일명 stem(예: 5610_웹사이트운영관리규칙). 규정명만으론 번호 프리픽스가 빠져
    404 — 청크 메타 path에서 정확 해석(가이드/용어처럼 번호 없는 것만 규정명==slug라 우연히 됐음)."""
    by_chunk, by_reg = {}, {}
    try:
        got = chroma_col().get(include=["metadatas"])
    except Exception:  # noqa: BLE001
        return by_chunk, by_reg
    for cid, m in zip(got["ids"], got["metadatas"]):
        p = m.get("path", "")
        if not p:
            continue
        slug = PurePosixPath(p).stem
        by_chunk[cid] = slug
        by_reg.setdefault(m.get("규정명", ""), slug)
    return by_chunk, by_reg


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    args = ap.parse_args()
    g = json.loads((DAILY_DIR / f"{args.date}.graded.json").read_text(encoding="utf-8"))
    items = g["문항"]

    # 문서 링크용 slug 심기(청크 우선, 규정명 폴백) — 출처에 slug 필드 추가
    by_chunk, by_reg = build_slug_index()
    for r in items:
        src = r.get("출처")
        if not src:
            continue
        slug = by_chunk.get(src.get("청크id", "")) or by_reg.get(src.get("규정명", ""))
        if slug:
            src["slug"] = slug

    # ── 약점 지도: 주제×유형 / 분류×유형 정답률 ──
    def acc_of(rows):
        ok = sum(1 for r in rows if r["판정"] == "정답")
        denom = sum(1 for r in rows if r["판정"] != "판정불가")
        return {"정답": ok, "표본": denom, "정답률": round(100 * ok / denom, 1) if denom else None}

    by_topic = defaultdict(list)
    for r in items:
        for t in (r.get("주제") or ["(미분류)"]):
            by_topic[t].append(r)
    topic_stats = {t: acc_of(rs) for t, rs in by_topic.items()}
    type_stats = {t: acc_of([r for r in items if r["유형"] == t])
                  for t in ("값형", "절차형", "조건형", "거부형")}
    quant_stats = {"정량": acc_of([r for r in items if r.get("정량여부")]),
                   "정성": acc_of([r for r in items if not r.get("정량여부")])}
    cause_stats = dict(Counter(r["원인"] for r in items if r.get("원인")))
    # ── 축별 정답률(specs/07 B): 결정적 축은 정답이 인덱스에서 나오므로 여기 하락 = 기능 회귀 ──
    axis_stats = {a: acc_of([r for r in items if r.get("축") == a])
                  for a in sorted({r["축"] for r in items if r.get("축")})}
    # ── 다양성 지표(specs/07 §4-2): 측정하지 않으면 문항은 다시 정형화된다 ──
    qs = [r["질문"] for r in items]
    tails = Counter(re.sub(r"[?？]\s*$", "", q)[-6:] for q in qs)
    diversity = {
        "문항수": len(qs),
        "평균길이": round(sum(len(q) for q in qs) / max(1, len(qs)), 1),
        "말미top": tails.most_common(5),
        "말미집중도": round(100 * tails.most_common(1)[0][1] / max(1, len(qs)), 1) if tails else 0,
        "출처문서수": len({(r.get("출처") or {}).get("규정명", "") for r in items if r.get("출처")}),
        "축비중": round(100 * sum(1 for r in items if r.get("축")) / max(1, len(items)), 1),
    }

    # ── 확정 리포트(내부) ──
    final = {**g, "약점지도": {"주제": topic_stats, "유형": type_stats, "정량정성": quant_stats,
                            "축": axis_stats},
             "원인": cause_stats, "다양성": diversity, "확정시각": datetime.datetime.now().isoformat(timespec="seconds")}
    (DAILY_DIR / f"{args.date}.json").write_text(
        json.dumps(final, ensure_ascii=False, indent=1), encoding="utf-8")

    # ── 웹 공개본(질문·답변·판정·증거·근거 열람 — 내부 로그인 뒤) ──
    qdir = ROOT / "web" / "public" / "quality" / "daily"
    qdir.mkdir(parents=True, exist_ok=True)
    # ⚠ 화이트리스트다 — 여기 없는 필드는 게시판에서 **존재 자체가 사라진다**(어휘층을 넣지
    #   않으면 문서어/일상어 갭을 화면에서 계산할 수 없다, specs/11 B2).
    pub_items = [{k: r.get(k) for k in
                  ("id", "질문", "유형", "정량여부", "주제", "분류", "판정", "증거", "원인",
                   "답변", "근거문장", "출처", "회귀", "축", "코호트", "실패유형",
                   "어휘층", "쌍id")} for r in items]
    (qdir / f"{args.date}.json").write_text(json.dumps(
        {"date": args.date, "정답률": g["정답률"], "집계": g["집계"],
         # 코호트 분리(docs/58 §6d) — 합산 정답률은 표본 구성에 지배된다(표본 85%가 매일 교체).
         #   재시험=개선 신호 / 신규=커버리지 신호. 둘을 섞으면 개선을 증명할 수 없다.
         "코호트별": g.get("코호트별") or {}, "실패유형별": g.get("실패유형별") or {},
         "약점지도": final["약점지도"], "원인": cause_stats, "다양성": diversity,
         "문항": pub_items},
        ensure_ascii=False, indent=1), encoding="utf-8")
    # index.json — 최근 90일 추이
    idx_f = qdir.parent / "index.json"
    idx = json.loads(idx_f.read_text(encoding="utf-8")) if idx_f.exists() else {"days": []}
    idx["days"] = [d for d in idx["days"] if d["date"] != args.date]
    idx["days"].append({"date": args.date, "정답률": g["정답률"], "집계": g["집계"],
                        "코호트별": g.get("코호트별") or {}})  # 추이에서도 코호트를 갈라 본다
    idx["days"] = sorted(idx["days"], key=lambda d: d["date"])[-90:]
    idx_f.write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding="utf-8")

    # ── 검수 큐 신호(원문결함·오답 규정) ──
    sig_f = ROOT / "tools" / ".daily_eval_signals.json"
    wrong_regs = Counter((r.get("출처") or {}).get("규정명", "") for r in items
                         if r["판정"] in ("오답", "검토필요") and r.get("출처"))
    sig_f.write_text(json.dumps({"generated": args.date,
                                 "오답규정": {k: v for k, v in wrong_regs.items() if k}},
                                ensure_ascii=False, indent=1), encoding="utf-8")

    # ── FAQ 브리지 후보(검색실패 오답만 · 원문 인용 초안 — 사람 검수용) ──
    FAQ_DIR.mkdir(exist_ok=True)
    cands = [r for r in items if r.get("원인") == "검색실패" and r["판정"] == "오답" and r.get("출처")]
    if cands:
        lines = [f"# FAQ 후보 초안 — {args.date} (⛔ 자동 편입 금지 · 사람 검수 후 10_업무가이드/FAQ/로)\n"]
        for r in cands:
            src = r["출처"]
            lines += [f"## Q. {r['질문']}\n",
                      f"- 근거 원문 인용(그대로): 「{r.get('근거문장', '') or '(채점 근거문장 없음 — 원문 확인)'}」",
                      f"- 출처: [[{src['규정명']}#{src['조']}]]" if src.get("조") else f"- 출처: [[{src['규정명']}]]",
                      f"- 오답 증거: {r.get('증거', '')}\n"]
        (FAQ_DIR / f"{args.date}.md").write_text("\n".join(lines), encoding="utf-8")

    print(f"공개본 → web/public/quality/daily/{args.date}.json · 추이 {len(idx['days'])}일")
    print(f"검수 신호 규정 {len(wrong_regs)}건 · FAQ 후보 {len(cands)}건")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
