#!/usr/bin/env python3
"""daily_grade.py — 일일 자가평가 ③ 3단 채점 + 원인 분류(docs/58 §3·§6).

오답 선언은 보수적으로("문서 대조로 증명"된 것만) — 이전 감사에서 채점기가 틀리고 모델이
맞은 사례가 실재(docs/15·55 교훈):
  ⓐ 결정적 수치대조(값형): 답변 값 토큰 vs 정답 청크 원문(정규화). 원문에 없는 값 = 오답 후보.
  ⓑ LLM 원문대조: 판정 JSON의 근거문장이 원문에 실존하는지 결정적 재검증(없으면 판정불가 강등).
  ⓒ 적대 재검(오답 후보만): "판정을 반박하라" — 반박 성공 시 '검토필요' 강등(오답 아님).
거부형: 거부 계열 표현이면 정답(pms_audit ⓓ 재사용).
최종: 정답 | 오답(증거) | 검토필요 | 판정불가. ⛔ 콘텐츠 수정은 사람 확정 후(절대 규칙).
실행: .venv/bin/python eval/daily_grade.py [--date YYYY-MM-DD]
"""
import argparse
import datetime
import json
import re
import sys

from daily_common import DAILY_DIR, chroma_col, llm_json, load_bank, norm_q, save_bank

REFUSAL_RE = re.compile(r"확인되지\s*않|확인할\s*수\s*없|찾을\s*수\s*없|근거가\s*없|명시(되어|돼)?\s*있지\s*않|명시되지\s*않|포함(되어|돼)?\s*있지\s*않|포함되지\s*않|나와\s*있지\s*않|규정(되어|돼)?\s*있지\s*않|규정되지\s*않|규정에서\s*확인|해당\s*내용(은|이)?\s*없|정보가\s*없|알\s*수\s*없")  # 거부 표현 확장(실측: 명시/포함되지 않음 미인식으로 정상 거부를 오답 처리 — daily 07-24 [5][6])
VAL_RE = re.compile(r"\d[\d,]*(?:\.\d+)?\s*(?:원|만원|천원|억원|%|퍼센트|일|개월|년|주|시간|회|명|점|급|호)")

JUDGE_SYS = (
    "너는 채점자다. [질문, 챗봇 답변, 정답 근거 원문]이 주어진다. 답변이 원문과 부합하는지 다음 "
    'JSON만 출력하라:\n{"판정": "<정답|부분|오답|판정불가>", "근거문장": "<원문에서 그대로 복사한 한 문장>", '
    '"어긋난점": "<오답/부분일 때 무엇이 원문과 다른지 한 줄, 아니면 빈 문자열>"}\n'
    "기준: 질문이 묻는 핵심을 원문대로 답했으면 정답. 핵심 값·결론이 원문과 다르면 오답. 일부만 맞으면 부분. "
    "원문만으로 판단이 어려우면 판정불가. 근거문장은 반드시 원문에서 글자 그대로 복사하라."
)

REBUT_SYS = (
    "너는 재심 판정가다. 어떤 답변이 '오답' 판정을 받았다. 그 판정이 잘못됐을 가능성을 검토하고 "
    "다음 JSON만 출력하라:\n"
    '{"반박성공": true/false, "분류": "<표기변형|질문모호|기타>", "이유": "<한 줄>"}\n'
    "분류 기준: ① '표기변형' = 답변이 사실상 정답인데 공백·단위·서수·동의어 등 표현만 다름 "
    "② '질문모호' = 질문 자체가 여러 해석이 가능해 정답 경계가 없음(출제 결함) "
    "③ '기타' = 원문 다른 부분이 답변을 지지하는 등 사람 판단이 필요한 경계 사례. "
    "반박 실패(오답이 맞음)면 반박성공=false, 분류=기타."
)


def get_chunk(cid: str, col) -> str:
    try:
        r = col.get(ids=[cid], include=["documents"])
        return r["documents"][0] if r["documents"] else ""
    except Exception:  # noqa: BLE001
        return ""


def classify_cause(item, golden: str) -> str:
    """오답·검토필요 원인 분류(docs/58 §6): 검색실패 | 생성환각 | 원문결함 | (채점오류는 ⓒ에서)"""
    srcs = item.get("x_sources", [])
    reg = (item.get("출처") or {}).get("규정명", "")
    jo = (item.get("출처") or {}).get("조", "")
    hit = any(s.get("규정명") == reg and (not jo or (s.get("조") or "").startswith(jo.split("의")[0]))
              for s in srcs)
    if not hit:
        return "검색실패"
    if "TODO" in golden or golden.count("|") > 30:  # 깨진 표 흔적
        return "원문결함"
    return "생성환각"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    args = ap.parse_args()
    qs = json.loads((DAILY_DIR / f"{args.date}.questions.json").read_text(encoding="utf-8"))["questions"]
    ans = {a["id"]: a for a in
           json.loads((DAILY_DIR / f"{args.date}.answers.json").read_text(encoding="utf-8"))["answers"]}
    col = chroma_col()
    # 골든문장(생성 시점 확정, docs/58 §7①) — 문항에 없으면 은행에서 보충(백필분)
    bank0 = {b["id"]: b for b in load_bank()}

    results = []
    for i, q in enumerate(qs):
        a = ans.get(q["id"], {})
        item = {**q, **a}
        답변 = a.get("답변", "")
        if not 답변:
            item.update({"판정": "판정불가", "증거": "답변 수집 실패"})
            results.append(item)
            continue
        # 거부형 — 거부 계열이면 정답
        if q["유형"] == "거부형":
            ok = bool(REFUSAL_RE.search(답변))
            item.update({"판정": "정답" if ok else "오답",
                         "증거": "" if ok else "코퍼스에 없는 주제인데 거부하지 않고 답변함(환각 위험)",
                         "원인": None if ok else "생성환각"})
            results.append(item)
            continue
        golden = get_chunk((q.get("출처") or {}).get("청크id", ""), col)
        if not golden:
            item.update({"판정": "판정불가", "증거": "정답 근거 청크 조회 실패"})
            results.append(item)
            continue
        gsent = q.get("골든") or (bank0.get(q["id"], {}).get("골든", ""))  # 골든문장(있으면 1차 기준)
        # 대조 소스 = 원문 + 출처 라벨(규정명·조) — 규정명 속 연도("2024년신입…") 오인 방지(실측)
        src_meta = q.get("출처") or {}
        gsrc = norm_q(golden + src_meta.get("규정명", "") + src_meta.get("조", ""))
        # ⓐ 결정적 수치대조(값형): 답변의 값 토큰이 원문에 없으면 오답 후보
        bad_vals = [v for v in VAL_RE.findall(답변) if norm_q(v) not in gsrc] if q["유형"] == "값형" else []
        # ⓑ LLM 원문대조
        j = {}
        try:
            golden_blk = (f"정답 근거 문장(핵심 기준 — 이 문장과 비교해 판정하라):\n「{gsent}」\n\n" if gsent else "")
            j = llm_json([{"role": "system", "content": JUDGE_SYS},
                          {"role": "user", "content": f"질문: {q['질문']}\n\n챗봇 답변:\n{답변[:1500]}\n\n{golden_blk}참고 원문(맥락):\n{golden[:1500]}"}],
                         max_tokens=260)
        except Exception as ex:  # noqa: BLE001
            print(f"  ⚠ 판정 실패 {q['id']}: {ex}", file=sys.stderr)
        판정 = str(j.get("판정", "판정불가"))
        # 근거문장 실존 검증(환각 판정 차단) — 완화: 정확 substring 대신 문자 2-그램 겹침 60%↑.
        # (판정자가 표기·공백을 조금 바꿔 인용해도 '근거 있음'으로 인정 — docs/15 공백 교훈. 순수
        #  환각 인용만 걸러냄) · 근거문장이 비면 검증 생략(판정은 유지).
        if 판정 in ("정답", "부분", "오답"):
            quote = norm_q(str(j.get("근거문장", "")))
            if len(quote) >= 8:
                qg = {quote[i:i + 2] for i in range(len(quote) - 1)}
                overlap = sum(1 for g in qg if g in gsrc) / max(1, len(qg))
                if overlap < 0.6:
                    판정 = "판정불가"
        if bad_vals and 판정 == "정답":
            판정 = "오답"  # 수치대조가 우선(정답 판정이어도 원문에 없는 값 주장 = 오답 후보)
            j["어긋난점"] = f"원문에 없는 값 주장: {', '.join(bad_vals[:4])}"
        if 판정 == "부분":
            판정 = "정답"  # 부분 정답은 정답으로 집계(보수적 오답주의) — 어긋난점은 기록
        # ⓒ 적대 재검(오답만) — 3갈래 재분류(docs/58 §7②): 표기변형→정답 승격 ·
        #    질문모호→폐기(출제 결함, 은행 retire) · 기타→검토필요(진짜 경계만 사람에게)
        if 판정 == "오답":
            try:
                r = llm_json([{"role": "system", "content": REBUT_SYS},
                              {"role": "user", "content": f"질문: {q['질문']}\n답변:\n{답변[:1200]}\n정답 근거 문장: {gsent or '(없음)'}\n원문:\n{golden[:1400]}\n오답 사유: {j.get('어긋난점','')}"}],
                             max_tokens=160)
                if r.get("반박성공") is True:
                    cls = str(r.get("분류", "기타")).strip()
                    if cls == "표기변형":
                        판정 = "정답"
                        j["재심"] = f"표기 변형 인정: {str(r.get('이유',''))[:100]}"
                    elif cls == "질문모호":
                        판정 = "폐기"
                        j["재심"] = f"출제 모호 판정: {str(r.get('이유',''))[:100]}"
                    else:
                        판정 = "검토필요"
                        j["재심"] = str(r.get("이유", ""))[:120]
            except Exception:  # noqa: BLE001
                pass
        item.update({"판정": 판정,
                     "증거": (str(j.get("재심", "")) if 판정 == "폐기" else str(j.get("어긋난점", "")))[:300]
                             if 판정 in ("오답", "검토필요", "폐기") else "",
                     "근거문장": (gsent or str(j.get("근거문장", "")))[:200],
                     "원인": classify_cause(item, golden) if 판정 in ("오답", "검토필요") else None})
        if item.get("원인") == "검색실패" and 판정 == "검토필요":
            pass  # 원인은 유지(재심 통과여도 검색 신호는 유효)
        results.append(item)
        if (i + 1) % 10 == 0:
            print(f"  … 채점 {i+1}/{len(qs)}")

    # 집계 + 은행 갱신(판정이력·상태)
    from collections import Counter
    cnt = Counter(r["판정"] for r in results)
    denom = len(results) - cnt.get("판정불가", 0) - cnt.get("폐기", 0)  # 폐기=출제 결함, 분모 제외
    acc = round(100 * cnt.get("정답", 0) / max(1, denom), 1)
    bank = load_bank()
    bh = {b["id"]: b for b in bank}
    for r in results:
        b = bh.get(r["id"])
        if not b:
            continue
        b.setdefault("판정이력", []).append({"date": args.date, "판정": r["판정"]})
        if r["판정"] == "오답":
            b["상태"] = "open"
        elif r["판정"] == "폐기":
            b["상태"] = "retire"  # 모호 출제 — 재출제 금지(자정)
        elif b.get("상태") == "open":
            last3 = [h["판정"] for h in b["판정이력"][-3:]]
            if len(last3) == 3 and all(v == "정답" for v in last3):
                b["상태"] = "fixed"
        b["최근판정"] = r["판정"]
    save_bank(bank)

    out = DAILY_DIR / f"{args.date}.graded.json"
    out.write_text(json.dumps({"date": args.date, "정답률": acc, "집계": dict(cnt),
                               "문항": results}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n정답률 {acc}% — {dict(cnt)} → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
