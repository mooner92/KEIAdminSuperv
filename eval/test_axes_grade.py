#!/usr/bin/env python3
"""test_axes_grade.py — 결정적 축 채점기 회귀 (axes.grade_amount).

⛔ 배경(2026-08-02 실측): "74만원 구입 전결" 문항이 3일 연속 '부분' — 답변은 "전결권자는
   실·팀장"으로 정확했는데, 절차 설명 속 '부서장'(물품구매지침의 실제 절차)까지 전체 스캔이
   주워 깎았다. 정확한 답이 벌점을 받으면 채점이 개선 방향을 오도한다(T7·T9 계열).
   축 채점기에 테스트가 없어서 이 결함이 3일을 살았다 — 이 파일이 그 구멍을 막는다.
픽스처 원칙: 핵심 케이스는 실측 답변 원문 발췌. LLM·네트워크·파일 I/O 없음.
실행: cd eval && ../tools/.venv/bin/python test_axes_grade.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from axes import grade_amount  # noqa: E402

KEY = {"판정키": {"업무키": "3.예산집행 > 가.원인행위 > 3) 물품구입 및 매각(도서포함) > 구입",
                "전결권자": "실･팀장", "구간": "200만원 이하",
                "원문행": "| | ･ 200만원 이하 | | ○ | | | |"}}

# 2026-08-01 실측 답변(발췌) — 전결권자 정답 + 절차 속 '부서장' 언급
REAL = ("**74만원 규모의 물품 구입은 실·팀장의 전결로 처리합니다.** 근거에 따르면 업무 "
        "'물품구입 및 매각(도서포함)'에서 금액 740,000원은 '200만원 이하' 구간에 해당하며, "
        "이 경우의 전결권자는 실·팀장입니다. 구매 요청 시 소속 부서장의 결재를 얻어 "
        "주관부서에 구매를 요청하고 처리해야 합니다.")


def test_correct_with_procedural_rank_is_correct():
    """⛔ 3일 산 결함 그 자체 — 절차 설명의 타 직급이 정답을 깎으면 안 된다."""
    v, why, _ = grade_amount(KEY, REAL)
    assert v == "정답", f"기대 정답, 실제 {v}({why})"


def test_genuine_hedge_stays_partial():
    """전결 문장 안에서 두 직급을 얼버무리면 여전히 부분 — 완화가 과하면 안 된다."""
    v, _, _ = grade_amount(KEY, "이 건은 실·팀장 또는 부서장 전결로 처리합니다.")
    assert v == "부분", f"기대 부분, 실제 {v}"


def test_wrong_rank_in_jeon_gyeol_sentence():
    v, _, ft = grade_amount(KEY, "74만원 구입은 부서장 전결로 처리합니다.")
    assert v == "오답" and ft == "생성환각", (v, ft)


def test_refusal_is_search_failure():
    v, _, ft = grade_amount(KEY, "규정에서 확인되지 않습니다. 담당 부서에 문의해 주세요.")
    assert v == "오답" and ft == "검색실패", (v, ft)


def test_fallback_when_no_jeon_gyeol_sentence():
    """전결 낱말이 없는 답변은 기존 전체 스캔으로 폴백 — 판정 공백이 생기면 안 된다."""
    v, _, _ = grade_amount(KEY, "해당 금액은 실·팀장이 결재권을 가집니다.")
    assert v == "정답", f"폴백 실패: {v}"


def test_no_rank_anywhere():
    v, _, _ = grade_amount(KEY, "위임전결규정 별표를 확인하시기 바랍니다.")
    assert v == "검토필요", v


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    bad = 0
    for fn in fns:
        try:
            fn()
            print(f"  ok  {fn.__name__}")
        except AssertionError as e:
            bad += 1
            print(f"  ❌  {fn.__name__}: {e}")
    sys.exit(1 if bad else print(f"\n✅ {len(fns)}개 통과 — 금액 축 채점(실측 픽스처)") or 0)
