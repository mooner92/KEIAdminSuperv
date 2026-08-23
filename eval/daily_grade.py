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

import axes  # 결정적 축 채점(specs/07 B)
import scenarios  # 복합 시나리오 채점(specs/07 A)
from daily_common import (CHRONIC_STREAK, DAILY_DIR, ROOT, chroma_col, chronic_of, llm_json,
                          load_bank, norm_q, prev_verdict, save_bank, wilson_ci)

sys.path.insert(0, str(ROOT / "tools"))
from refusal_detect import is_refusal  # 단일 정본(specs/01 P0) — 결론부 스코프+부정형 한정(T9)
VAL_RE = re.compile(r"\d[\d,]*(?:\.\d+)?\s*(?:원|만원|천원|억원|%|퍼센트|일|개월|년|주|시간|회|명|점|급|호)")

# ── 골든 결함 후보 감지 (docs/58 §6d) ─────────────────────────────────────────────
# 실측(2026-07-30): 미정답 8건 중 2건은 시스템이 근거를 정확히 회수했는데도 채점이 불가능했다.
#   · "15. 연구안내게시판의 게시글 등록·수정 권한과 게시종료 기능."  ← 목차 항목이 골든
#   · "-회의 개최경비는 당해 연구 또는 행사 수행과 … 소요경비"        ← 문장 파편이 골든
# 이런 골든은 답변 품질과 무관하게 정답률을 깎는다 → 라벨을 붙여 사람이 손볼 수 있게 한다.
# ⛔ 의도적으로 보수적이다 — 목차·목록 마커만 본다. '문장 종결 없음' 같은 넓은 휴리스틱은
#   표에서 뽑은 정상 골든(예: "… 200만원 이하 → 전결권자 실･팀장")을 오탐해서 쓰지 않는다.
# ⛔ 라벨만 — 정답률 분모를 바꾸지 않는다(출제 결함 확정은 사람만, retire 상태로).
GOLDEN_FRAG_RE = re.compile(r"^\s*(?:\d+[.)]|[-·•*])")


def golden_suspect(golden: str) -> bool:
    """골든이 목차 항목·목록 파편으로 보이면 True(채점 자체가 불가능한 출제 결함 후보)."""
    g = (golden or "").strip()
    if not g:
        return True
    return bool(GOLDEN_FRAG_RE.match(g))


def cohort_of(bank_entry) -> str:
    """문항 코호트. ⚠ 오늘 판정이력을 append하기 **전에** 호출해야 한다.

    재시험 = 이전에 이미 채점된 문항(주로 이월된 실패) → 여기 정답률이 '개선 신호'.
    신규   = 오늘 처음 출제 → '커버리지 신호'이며 표본 구성에 크게 흔들린다.
    """
    return "재시험" if (bank_entry and (bank_entry.get("판정이력") or [])) else "신규"


def classify_failure(item: dict) -> str:
    """미정답 문항의 성격 라벨(집계·보강 우선순위용). 정답이면 "".

    검색으로 고칠 것 / 생성으로 고칠 것 / 골든을 손볼 것을 갈라 본다 —
    합산 정답률만 보면 셋이 한 숫자에 섞여 어디를 고쳐야 할지 알 수 없다.
    """
    v = item.get("판정")
    if v == "정답":
        return ""
    if v == "폐기":
        return "출제결함"
    # ⚠ 거부형은 설계상 골든이 없다(코퍼스 밖 시드) — golden_suspect("")==True 가 모든
    #   거부형 실패를 '골든품질'(노이즈)로 삼켰다(25회차 전수: 생성환각 72 + 시드재검토 19,
    #   예외 0 — 2026-08-10 실측, specs/16 W1-B). 거부형만 면제한다. 전면 재순서는 하지
    #   않는다: LLM 채점 문항은 골든이 손상되면 채점 자체가 불신 대상이라 골든품질 우선이 옳다.
    if golden_suspect(item.get("골든") or "") and item.get("유형") != "거부형":
        return "골든품질"
    cause = item.get("원인")
    # ⚠ 새 원인을 만들면 **여기에도 넣어야 한다**. 2026-08-07 실측: 전날 신설한 '근거부적합'을
    #   빠뜨려 2건이 '미분류'로 떨어졌고, 수술대기(daily_report)에서 통째로 사라졌다 —
    #   아래 주석이 경고하던 '분류기 구멍'을 신설 원인이 그대로 밟았다.
    if cause in ("검색실패", "생성환각", "원문결함", "시드재검토", "근거부적합"):
        return str(cause)
    if v == "판정불가":
        return "판정불가-기타"
    if v == "부분":
        return "부분정답"
    # 실측 결함(2026-07-30 재실행): 재심(REBUT) 경로가 내는 '검토필요'에 원인이 안 붙으면
    #   여기까지 흘러내려 '미분류'로 집계됐다. '미분류'는 **분류기 구멍**을 뜻해야 하고,
    #   알려진 판정값이 버킷 없이 남은 상태를 뜻해선 안 된다 — 구멍이 통계로 위장된다.
    if v == "검토필요":
        return "검토필요-기타"
    return "미분류"

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


# 근거가 질문 사안을 '직접 규율'하는지 판단할 때 무시할 일반어 — 이런 말은 어느 근거에나 있어
# governed를 남발시킨다(거부형 오답을 전부 삼켜 과잉응답 감시가 죽는다).
_GENERIC = {"방법", "요청", "경우", "절차", "규정", "기준", "관련", "사항", "내용", "확인", "가능",
            "신청", "처리", "이용", "사용", "어디", "무엇", "누구", "언제", "얼마", "지급", "관리"}


def _governed(question: str, srcs: list) -> bool:
    """거부형 문항에서 — 회수된 근거가 질문의 **고유 사안어**를 담고 있는가(결정적).
    담고 있으면 '코퍼스 밖'이라는 시드 가정이 틀렸을 수 있으므로 오답으로 단정하지 않는다."""
    keys = [w for w in re.findall(r"[가-힣]{2,}", question) if w not in _GENERIC]
    if not keys:
        return False
    blob = " ".join((s.get("snippet") or "") + (s.get("규정명") or "") for s in (srcs or [])[:3])
    return any(k in blob for k in keys)


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
        # 복합 시나리오 — 근거가 여러 개다. 골든별 개별 대조(결정적)로 채점하고,
        # 멀티턴이면 후속 턴에서 맥락을 잃었는지(거부로 새는지)까지 본다.
        if q.get("형식") == "복합":
            판정, 증거, 원인 = scenarios.grade_scenario(item, 답변)
            turns = a.get("턴답변") or []
            if 판정 == "정답" and len(turns) > 1 and is_refusal(turns[-1]):
                판정, 증거, 원인 = "부분", "후속 턴에서 맥락을 잃고 거부함(멀티턴 회귀)", "검색실패"
            item.update({"판정": 판정, "증거": 증거, "원인": 원인})
            results.append(item)
            continue
        # 축 문항 — 파생 인덱스가 정답을 이미 가지고 있으므로 **LLM 없이** 결정적으로 채점한다.
        # (채점기 오판이 개선 방향을 오도한 T7·T9 계열 사고가 이 축들에선 구조적으로 불가능)
        # ⚠ item(=q+answer)을 넘긴다. q만 넘기면 채점기 안에서 x_sources를 볼 수 없어
        #   거부가 전부 '검색실패'로 샌다(2026-08-06 실측: 56건 중 9건 오분류).
        if q.get("축"):
            판정, 증거, 원인 = axes.grade(item, 답변)
            item.update({"판정": 판정, "증거": 증거, "원인": 원인})
            results.append(item)
            continue
        # 거부형 — 결론부가 거부 계열이면 정답(T9: 꼬리 부가문구·긍정문 오탐 제거).
        # ⚠ 2026-07-26: "정답=거부"라는 **시드 가정 자체가 검증된 적이 없었다**. 볼트 전수 감사
        #   결과 시드 20개 중 16개가 코퍼스에 언급이 있었고, '탕비실 커피머신 수리'는 물품 지침
        #   제15조가 실제로 규율한다(모델이 정확히 인용해 답했는데 오답으로 집계됨).
        #   → 거부하지 않은 답을 **일률적으로 오답 처리하지 않는다**(T7·T9와 같은 계열의 측정 오류).
        if q["유형"] == "거부형":
            if is_refusal(답변):
                item.update({"판정": "정답", "증거": "", "원인": None})
            elif _governed(q["질문"], a.get("x_sources", [])):
                item.update({"판정": "검토필요",
                             "증거": "거부하지 않았으나 인용 근거가 질문 사안을 실제로 규율할 수 있음 "
                                   "— 시드('코퍼스 밖') 가정 재검토 필요",
                             "원인": "시드재검토"})
            else:
                item.update({"판정": "오답",
                             "증거": "코퍼스에 없는 주제인데 근거 없이 답변함(환각)",
                             "원인": "생성환각"})
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
        # ── 코호트 판정 (docs/58 §6d) — ⚠ 오늘 이력을 append하기 **전**에 정해야 한다 ──
        #   재시험 = 이전에 이미 채점된 문항(주로 이월된 실패). 여기 정답률이 곧 '개선 신호'다.
        #   신규   = 오늘 처음 출제. 여기 정답률은 '커버리지 신호'이고 표본 구성에 크게 흔들린다.
        # 실측(2026-07-30): 29일↔30일 공통 문항이 60건 중 9건뿐 — 표본 85%가 매일 교체된다.
        #   그래서 합산 정답률의 일별 비교(80.7→91.2)는 대부분 표본 구성이고, 개선 여부를
        #   말해주지 못한다. 코호트를 나누면 재시험분에서 오답 7→1이 깨끗하게 보인다.
        r["코호트"] = cohort_of(b)
        # ⛔ 코호트 값은 그대로 둔다(재시험·신규 2종) — 만성은 **직교 축**의 별도 필드다.
        #    코호트에 '만성'을 세 번째 값으로 끼우면 과거 파일과 비교가 끊긴다(Wave 규약).
        r["만성"] = chronic_of(b)
        r["직전판정"] = prev_verdict(b)
        r["실패유형"] = classify_failure(r)
        if not b:
            continue
        b.setdefault("판정이력", []).append({"date": args.date, "판정": r["판정"]})
        # ⛔ retire는 **종착 상태**다 — 사람이 출제 결함으로 폐기 확정한 문항.
        #    실측(2026-07-27): 폐기한 2문항이 재채점 때 open으로 덮어써져 다음 날 회귀 풀에
        #    되살아났고, 결함 문항이 계속 통계를 오염시켰다. 이력만 남기고 상태는 건드리지 않는다.
        if b.get("상태") == "retire":
            b["최근판정"] = r["판정"]
            continue
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

    # ── 코호트별·실패유형별 집계 (docs/58 §6d) ──
    # ⛔ 합산 `정답률`은 계산식을 바꾸지 않는다(과거 일자와 비교 가능해야 한다).
    #    코호트는 *같은 분모 규칙*으로 따로 계산한 표시용 지표다.
    #    ⛔ **분모와 신뢰구간을 함께 새긴다**(2026-08-23). 정답률 값은 한 자리도 바뀌지 않는다 —
    #    재시험은 분모가 n≈46이라 95% 구간이 ±14%p인데, 브리핑은 5~10%p 스윙을 신호처럼
    #    읽어 왔다("b회차가 a보다 나쁘다" 가설의 출처). 구간이 없으면 잡음을 회귀로 오진한다.
    def _acc(rows: list) -> dict:
        c = Counter(r["판정"] for r in rows)
        d = len(rows) - c.get("판정불가", 0) - c.get("폐기", 0)
        lo, hi = wilson_ci(c.get("정답", 0), d)
        return {"문항수": len(rows), "집계": dict(c), "분모": d,
                "정답률": round(100 * c.get("정답", 0) / d, 1) if d else None,
                "신뢰구간": [lo, hi]}

    코호트별 = {n: _acc([r for r in results if r.get("코호트") == n]) for n in ("재시험", "신규")}
    실패유형별 = dict(Counter(r["실패유형"] for r in results if r.get("실패유형")))

    # ── 만성 분해 — 재시험을 '오늘 새로 깨진 것' vs '묵은 부채'로 가른다 ──
    #    ⛔ 합산 `정답률`·`코호트별`은 손대지 않는다(과거 일자와 비교 가능해야 한다).
    재시험 = [r for r in results if r.get("코호트") == "재시험"]
    만성 = [r for r in 재시험 if r.get("만성")]
    급성 = [r for r in 재시험 if not r.get("만성")]
    # 신규회귀 = 직전 회차엔 맞혔는데 오늘 틀린 것 = **오늘 새로 깨진 것**의 직답.
    #   분모(직전정답)를 함께 낸다 — 건수만 보면 표본 크기에 속는다.
    직전정답 = [r for r in 재시험 if r.get("직전판정") == "정답"]
    새로깨짐 = [r for r in 직전정답 if r["판정"] not in ("정답", "폐기", "판정불가")]
    만성트랙 = {"기준": f"직전까지 연속 미정답 {CHRONIC_STREAK}회 이상",
                "만성": _acc(만성), "재시험_만성제외": _acc(급성),
                "신규회귀": {"건수": len(새로깨짐), "분모_직전정답": len(직전정답),
                          "비율": round(100 * len(새로깨짐) / len(직전정답), 1) if 직전정답 else None,
                          # 분모가 20 안팎이라 이 비율도 구간이 넓다. 실측(2026-08-23):
                          # 08-21~23b에 새로깨짐률이 11.9%→21.4%(p=0.006)로 올라 회귀처럼
                          # 보였는데, **분모 구성 변화**였다 — '이력 정답률 ≥0.8' 문항이
                          # 직전정답 분모에서 31%→2%로 사라졌다(회귀 풀이 진동하는 묵은
                          # open만 남기고, 잘 맞히는 문항은 3연속 정답으로 fixed 졸업).
                          # 사전 구성으로 직접표준화하면 21.4%→15.0%로 대부분이 설명된다.
                          "신뢰구간": list(wilson_ci(len(새로깨짐), len(직전정답)))}}

    out = DAILY_DIR / f"{args.date}.graded.json"
    out.write_text(json.dumps({"date": args.date, "정답률": acc, "집계": dict(cnt),
                               "코호트별": 코호트별, "만성트랙": 만성트랙, "실패유형별": 실패유형별,
                               "문항": results}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n정답률 {acc}% — {dict(cnt)} → {out}")
    for n, v in 코호트별.items():
        print(f"  · {n}: {v['정답률']}% ({v['문항수']}건) {v['집계']}")
    print(f"  · └만성제외 재시험: {만성트랙['재시험_만성제외']['정답률']}% "
          f"({만성트랙['재시험_만성제외']['문항수']}건) · 만성 {만성트랙['만성']['정답률']}% "
          f"({만성트랙['만성']['문항수']}건) · 신규회귀 {만성트랙['신규회귀']['건수']}"
          f"/{만성트랙['신규회귀']['분모_직전정답']}")
    print(f"  · 실패유형: {실패유형별}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
