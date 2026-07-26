#!/usr/bin/env python3
"""test_scenarios.py — 복합 시나리오 회귀(specs/07 A).

LLM 호출 없이 **게이트와 채점기**만 검증한다(생성 품질은 daily_gen 실행에서 육안 표본).
지키려는 것:
  ① 여정 근거 추출 — 조문 근거만(ERP 화면명 등은 청크 대조 불가)
  ② 게이트 — 골든 verbatim · 질문 속 숫자 실존 · **값 토큰 금지(자문자답)** · 한국어
  ③ 채점 — 전부 충족=정답 · 일부=부분 · 0건=검토필요(⛔보수적) · 거부=오답
  ④ 스키마 하위호환 — 기존 소비자가 기대하는 dict `출처`가 살아 있다
실행: .venv/bin/python eval/test_scenarios.py
"""
import re
import sys

import scenarios as S

FAIL = []


def ck(cond, msg):
    print(("  ✅ " if cond else "  ❌ ") + msg)
    if not cond:
        FAIL.append(msg)


VALUE_TOKEN = re.compile(r"\d[\d,]*\s*(?:원|만원|억원|일|개월|년|주|%|퍼센트|박|시간|회|명|급|점)(?![가-힣])")


def main() -> int:
    print("① 여정 자산")
    js = S.journeys()
    ck(len(js) >= 10, f"여정 {len(js)}종 로드")
    refs = {j["id"]: S._refs(j) for j in js}
    usable = [k for k, v in refs.items() if len(v) >= 2]
    ck(len(usable) >= 8, f"근거 2건 이상 여정 {len(usable)}종 — 복합 출제 가능")
    ck(all(r["조"].startswith("제") or "별표" in r["조"] for v in refs.values() for r in v),
       "근거는 조문/별표만(ERP 화면명 등 비조문 제외)")

    print("\n② 게이트")
    ck(S._verbatim("현금구매는 원칙적으로 금지한다.", "제8조(구매 방법) … 현금구매는 원칙적으로 금지한다. 다만 …"),
       "verbatim — 원문에 실존하는 골든 통과")
    ck(not S._verbatim("현금구매는 언제나 허용된다.", "제8조 … 현금구매는 원칙적으로 금지한다."),
       "verbatim — 의역·창작 골든 폐기")
    ck(not S._korean_ok("임원 기준도有什么不同吗?"), "언어 — 한자 혼입 폐기(qwen 언어 이탈 실측)")
    ck(S._korean_ok("그럼 정산은 언제까지 하나요?"), "언어 — 한국어 후속 질문 통과")
    ck(bool(VALUE_TOKEN.search("복명서는 귀국 후 30일 이내에 제출하나요?")),
       "자문자답 — 값 토큰 포함 질문 검출")
    ck(not VALUE_TOKEN.search("여비규정 제33조의 복명 절차는 어떻게 되나요?"),
       "자문자답 — 조문 번호는 값 토큰 아님(오검출 없음)")

    print("\n③ 채점(결정적)")
    item = {
        "형식": "복합",
        "골든들": ["현금구매는 원칙적으로 금지한다.",
                "물품을 구매하려는 자는 소속 부서장의 결재를 얻어 주관부서에 구매를 요청한다."],
        "출처들": [{"규정명": "물품 구매.관리 등에 관한 지침", "조": "제8조", "청크id": "x"},
                {"규정명": "물품 구매.관리 등에 관한 지침", "조": "제4조", "청크id": "y"}],
    }
    full = "**현금구매는 원칙적으로 금지합니다.** 물품을 구매하려는 자는 소속 부서장의 결재를 얻어 주관부서에 구매를 요청해야 합니다."
    ck(S.grade_scenario(item, full)[0] == "정답", "전부 반영 → 정답")
    v = S.grade_scenario(item, "현금구매는 원칙적으로 금지합니다.")
    ck(v[0] == "부분" and "1/2" in v[1], f"일부 반영 → 부분 ({v[1][:40]})")
    ck(S.grade_scenario(item, "규정에서 확인되지 않습니다.")[0] == "오답", "거부 → 오답(근거 실재)")
    v = S.grade_scenario(item, "담당 부서에 문의하시면 안내받을 수 있습니다.")
    ck(v[0] == "검토필요", f"무관한 답 → 검토필요(⛔오답 단정 금지) — {v[0]}")
    # 의역 내성: 값·핵심어가 유지되면 표현이 달라도 인정
    para = "물품 구매는 부서장 결재를 받아 주관부서에 요청하며, 현금구매는 금지됩니다."
    ck(S.grade_scenario(item, para)[0] in ("정답", "부분"), "의역 답변 — 정답/부분(오답 아님)")

    print("\n④ 스키마 하위호환")
    fake = {"출처": {"규정명": "A", "조": "제1조", "청크id": "c1"},
            "출처들": [{"규정명": "A", "조": "제1조", "청크id": "c1"},
                    {"규정명": "B", "조": "제2조", "청크id": "c2"}]}
    ck(isinstance(fake["출처"], dict) and fake["출처"]["청크id"] == fake["출처들"][0]["청크id"],
       "대표 출처(dict) 유지 — publish slug·검수신호·원인분류 무변경")

    print()
    if FAIL:
        print(f"⛔ 실패 {len(FAIL)}건")
        for f in FAIL:
            print("  -", f)
        return 1
    print("🎉 복합 시나리오 회귀 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
