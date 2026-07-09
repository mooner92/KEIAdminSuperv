#!/usr/bin/env python3
"""test_numeric_gate.py — P0-1 수치 검증 게이트 유닛 (docs/22 §1).

실측 환각("연간 근무일수 248일", 연말정산 "1월 18일 마감")이 경고되고,
근거에 있는 수치·단위 변환·명시적 계산식·인용 번호는 경고되지 않아야 한다(절대 규칙1의 서버측 강제).

실행: .venv/bin/python tools/test_numeric_gate.py  (모델 미로딩 — 순수 로직)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rag_core import TABLE_BROKEN_MARK, _num_values, numeric_guard_note  # noqa: E402

CTX = (
    "[여비규정 별표2]\n"
    "숙박비 상한: 특별시 100,000원, 광역시 80,000원, 그 밖의 지역 70,000원. 일비 1만원, 식비 25,000원.\n\n"
    "[복무규정 제16조]\n"
    "1년간 80퍼센트 이상 출근한 임･직원에게는 연 15일의 연차휴가. 1년 미만은 1개월 당 1일.\n"
    "숙박비 상한액의 10분의 3을 추가 지급할 수 있다. <개정 2023. 12. 29.>\n"
)


def note(q, a, ctx=CTX):
    return numeric_guard_note(q, a, ctx)


# ── 실측 환각 차단 ─────────────────────────────────────────────────
def test_fabricated_day_count_flagged():
    n = note("연간 근무일수 알려줘", "1년 중 근무일수는 총 248일입니다 [복무규정 제11조]")
    assert "248일" in n and "수치 확인 필요" in n


def test_fabricated_date_flagged():
    n = note("연말정산 마감 언제야?", "회계 증빙 마감은 1월 18일(목)입니다.")
    assert "1월 18일" in n


def test_fabricated_amount_flagged():
    n = note("경조금 얼마야?", "부모상 시 경조금은 300만 원입니다.")
    assert "3,000,000원" in n


# ── 정상 인용 통과(과차단 방지) ────────────────────────────────────
def test_verbatim_amount_passes():
    assert note("숙박비 얼마?", "특별시 기준 100,000원입니다.") == ""


def test_unit_reformat_passes():
    assert note("숙박비 얼마?", "특별시는 10만원, 그 밖의 지역은 7만 원까지입니다.") == ""


def test_composite_amount_passes():
    ctx = CTX + "\n[수당규정 제3조]\n자문수당은 35,000원으로 한다.\n"
    assert note("자문수당?", "자문수당은 3만5천원입니다.", ctx) == ""


def test_day_and_year_pass():
    assert note("연차 며칠?", "1년간 80% 이상 출근 시 연 15일이며, 1년 미만은 1개월 당 1일입니다.") == ""


def test_fraction_to_percent_passes():
    assert note("추가 지급?", "숙박비 상한액의 30%를 추가 지급할 수 있습니다.") == ""


def test_question_numbers_allowed():
    assert note("3일 출장 다녀왔어요. 정산 어떻게 해요?", "3일간의 출장은 정산 신청을 하면 됩니다.") == ""


def test_citation_numbers_ignored():
    assert note("근거?", "[여비규정 제33조] 및 별표 2, 별지 제5호 서식 참조. <개정 2020. 12. 28.>") == ""


def test_erp_code_and_phone_ignored():
    assert note("메뉴?", "ERP gen_0020M 메뉴에서 신청하세요. 문의 ☎ 044-415-7016") == ""


# ── 계산식 허용(규칙 10 정합) ──────────────────────────────────────
def test_explicit_calc_result_allowed():
    a = "일비 1만원 × 3일 = 3만원이 지급됩니다."
    assert note("3일 출장 일비?", a) == ""


def test_wrong_calc_flagged():
    a = "일비 1만원 × 3일 = 5만원이 지급됩니다."
    n = note("3일 출장 일비?", a)
    assert "50,000원" in n


def test_bare_total_without_formula_flagged():
    # 근거에 없는 합계를 식 없이 단정 → 경고(식 제시를 유도)
    n = note("3일 출장 총비용?", "총 13만 원이 지급됩니다.")
    assert "130,000원" in n


# ── P0-3 연동: 표손상 블록의 수치는 허용집합에서 제외 ────────────────
def test_broken_table_values_excluded():
    ctx = (f"[상조회규약 별표1 {TABLE_BROKEN_MARK}]\n사망 본인 : 3,000,000원 부모 : 500,000원\n\n"
           "[복무규정 제16조]\n연 15일")
    n = numeric_guard_note("부모상 경조금?", "부모상 경조금은 300만 원입니다.", ctx)
    assert "3,000,000원" in n  # 깨진 표의 '실존 값'도 오결합 위험 → 경고


def test_intact_block_after_broken_still_allowed():
    ctx = (f"[상조회규약 별표1 {TABLE_BROKEN_MARK}]\n사망 본인 : 3,000,000원\n\n"
           "[여비규정 별표2]\n숙박비 100,000원")
    assert numeric_guard_note("숙박비?", "숙박비는 100,000원입니다.", ctx) == ""


# ── 표 셀 무단위 숫자 허용(실측 과차단 수정) ─────────────────────────
def test_bare_table_numbers_allowed():
    """가이드 표 '| 결혼 | 본인 자녀 | 5 1 |'처럼 단위가 헤더에 있고 셀엔 숫자만 있는 경우 —
    답변 '결혼 5일'이 과차단되지 않아야 한다(라이브 실측 사례)."""
    ctx = ("[KEI휴가의모든것]\n| 구분 | 대상 | 일수 |\n| 결혼 | 본인 자녀 | 5 1 |\n"
           "| 출산 | 배우자 | 20(25) |\n| 사망 | 배우자, 부모 | 5 3 3 3 |")
    assert numeric_guard_note("경조사 휴가 며칠?", "결혼은 본인 5일, 자녀 1일이며 배우자 출산은 20일(다태아 25일)입니다.", ctx) == ""


def test_bare_table_numbers_with_list_commas():
    """여비규정 별표2 실제 형식: '상한액: 특별시 100,000, 광역시 80,000, 그 밖의 지역은 70,000'
    — 나열 쉼표가 바로 뒤따라도 수확돼야 한다(라이브 실측 과차단 사례)."""
    ctx = ("[여비규정 별표 2]\n| 구분 | 숙박비 (1박당) |\n"
           "| 제5호 내지 제6호 | 실비 (상한액: 특별시 100,000, 광역시 80,000, 그 밖의 지역은 70,000) |")
    a = "숙박비 상한은 특별시 10만 원, 광역시 8만 원, 그 밖의 지역 7만 원입니다."
    assert numeric_guard_note("숙박비 상한?", a, ctx) == ""


def test_bare_numbers_outside_tables_not_harvested():
    """표 밖 본문의 무단위 숫자는 허용집합에 들어가지 않는다(게이트 약화 방지)."""
    ctx = "[복무규정 제16조]\n연차휴가는 연 15일이다. 부칙 248 참조."
    n = numeric_guard_note("근무일수?", "연간 근무일수는 248일입니다.", ctx)
    assert "248일" in n


def test_broken_table_bare_values_still_excluded():
    """표손상 블록의 무단위 숫자(병합 51, 5333)는 수확되지 않는다."""
    ctx = (f"[복무규정 별표 1 {TABLE_BROKEN_MARK}]\n| 결혼 | 본인자녀 | 51 |\n| 사망 | 배우자… | 5333 |\n\n"
           "[복무규정 제16조]\n연차휴가는 연 15일이다.")
    n = numeric_guard_note("결혼 휴가?", "결혼 휴가는 51일입니다.", ctx)
    assert "51일" in n


# ── 추출기 단위 ────────────────────────────────────────────────────
def test_num_values_extraction():
    vals = _num_values("숙박비 100,000원, 10만원, 3만5천원, 10분의 3, 1월 18일, 15일, 제46조")
    assert ("원", 100000.0) in vals and ("원", 35000.0) in vals
    assert ("%", 30.0) in vals and ("날짜", (1, 18)) in vals and ("일", 15.0) in vals
    assert not any(v == 46 for _, v in vals if not isinstance(v, tuple))  # 조문 번호 제외


def test_empty_and_error_safe():
    assert numeric_guard_note("q", "", CTX) == ""
    assert numeric_guard_note("q", "숫자 없는 답변입니다.", None) == ""


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"  ok  {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  ❌  {fn.__name__}: {e}")
    if failed:
        sys.exit(1)
    print(f"\n✅ {len(fns)}개 테스트 통과 — P0-1 수치 검증 게이트")
