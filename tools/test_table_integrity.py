#!/usr/bin/env python3
"""test_table_integrity.py — P0-3 표 무결성 격리 유닛 (docs/22 §2).

실측 사고 문서(상조회규약 별표·복무규정 별표1)는 손상으로 잡고,
정상 표(여비 별표2 상한 3종·'5 1' 공백 병렬)는 잡지 않아야 한다(정밀도 우선 — 과탐=거짓 경고).

실행: .venv/bin/python tools/test_table_integrity.py  (모델 미로딩 — 순수 로직)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rag_core import (  # noqa: E402
    TABLE_BROKEN_MARK, _overlay_table_integrity, _table_broken, numeric_guard_note,
)

SANGJO_CELL = ("| 결혼 개원기념일 퇴직 사망 입원 재해 출산축하금 칠순 또는 팔순 | "
               "본인 및 자녀 : 500,000원 개원기념일 축하금 : 50,000원/회원 정년퇴직 : 1,000,000원 "
               "중도퇴직 : 500,000원 본인 : 3,000,000원 배우자, 자녀 : 1,000,000원 "
               "본인 및 배우자의 부모 : 500,000원 본인, 배우자 : 300,000원 부모 : 100,000원 |")
BOKMU_ROWS = "| 결    혼 | 본    인자    녀 | 51 |\n| 사    망 | 배우자, 본인 및 배우자의 부모 형제자매 | 5333 |"


# ── 감지: 실사고는 잡는다 ─────────────────────────────────────────
def test_sangjo_mega_cell_detected():
    assert _table_broken(SANGJO_CELL) is not None


def test_merged_digits_detected():
    assert _table_broken(BOKMU_ROWS) is not None


# ── 정밀도: 정상 표는 안 잡는다 ────────────────────────────────────
def test_yeobi_lodging_cell_intact():
    """여비 별표2: 한 셀 금액 3종이지만 라벨 짝이 살아있음 — 정상."""
    line = "| 제5호 내지 제6호 | 실비 (상한액: 특별시 100,000, 광역시 80,000, 그 밖의 지역은 70,000) | 25,000 |"
    assert _table_broken(line) is None


def test_spaced_parallel_values_intact():
    """휴가 가이드 '5 1'·'5 3 3 3'(공백 병렬)은 병합('51')과 달리 정상."""
    assert _table_broken("| 결혼 | 본인 자녀 | 5 1 |\n| 사망 | 배우자, 부모 | 5 3 3 3 |") is None


def test_real_two_digit_value_intact():
    """'20'(0 포함 실수치)은 대상이 여럿이어도 병합으로 보지 않는다."""
    assert _table_broken("| 출산 | 배우자, 본인 | 20 |") is None


def test_plain_text_intact():
    assert _table_broken("숙박비는 100,000원, 80,000원, 70,000원, 60,000원, 50,000원이다.") is None  # 표 아님


def test_flattened_table_detected():
    """실측(경조사 가이드): | 없이 카테고리 라인 뭉치 + '라벨 : 금액원' 라인 뭉치로 평탄화된 표."""
    flat = ("결혼\n개원기념일\n퇴직\n사망\n입원\n재해\n출산축하금\n칠순 또는 팔순\n"
            "본인 및 자녀 : 500,000원\n정년퇴직 : 1,000,000원\n본인 : 3,000,000원\n"
            "배우자, 자녀 : 1,000,000원\n본인 및 배우자의 부모 : 500,000원")
    assert _table_broken(flat) is not None


def test_short_list_not_flattened():
    """짧은 목록+금액 1~2건은 평탄화 표로 보지 않는다(과탐 방지)."""
    ok = "구비서류\n신청서\n영수증\n계좌사본\n수수료 : 5,000원"
    assert _table_broken(ok) is None


# ── 오버레이: 라벨·마커·정합 ──────────────────────────────────────
def test_overlay_marks_block_and_src():
    srcs = [{"규정명": "상조회규약", "조": "별표1"}, {"규정명": "복무규정", "조": "제16조"}]
    blocks = [f"[상조회규약 별표1]\n{SANGJO_CELL}", "[복무규정 제16조]\n연차휴가는 연 15일이다."]
    _overlay_table_integrity(srcs, blocks)
    assert srcs[0].get("표깨짐") is True and TABLE_BROKEN_MARK in blocks[0].splitlines()[0]
    assert "수치를 인용하지 말고" in blocks[0]
    assert "표깨짐" not in srcs[1] and TABLE_BROKEN_MARK not in blocks[1]


def test_overlay_flattened_no_pipe():
    """평탄화 표 청크는 '|'가 없어도 오버레이가 잡아야 한다(라이브 실측 — | 필터로 누락됐던 결함)."""
    flat = ("<참고 3> 상조회 경조금 지급기준\n결혼\n개원기념일\n퇴직\n사망\n입원\n재해\n출산축하금\n칠순 또는 팔순\n"
            "본인 및 자녀 : 500,000원\n정년퇴직 : 1,000,000원\n본인 : 3,000,000원\n배우자, 자녀 : 1,000,000원")
    srcs = [{"규정명": "KEI경조사관련절차안내"}]
    blocks = [f"[KEI경조사관련절차안내]\n{flat}"]
    _overlay_table_integrity(srcs, blocks)
    assert srcs[0].get("표깨짐") is True and TABLE_BROKEN_MARK in blocks[0].splitlines()[0]


def test_overlay_idempotent():
    srcs = [{"규정명": "상조회규약"}]
    blocks = [f"[상조회규약 별표1 {TABLE_BROKEN_MARK}]\n{SANGJO_CELL}"]
    before = blocks[0]
    _overlay_table_integrity(srcs, blocks)
    assert blocks[0] == before  # 이미 마킹된 블록은 재처리 없음


# ── P0-1 결합: 격리 블록의 값이 답변에 나오면 경고 ───────────────────
def test_broken_block_amount_warned():
    srcs = [{"규정명": "상조회규약"}]
    blocks = [f"[상조회규약 별표1]\n{SANGJO_CELL}"]
    _overlay_table_integrity(srcs, blocks)
    ctx = "\n\n---\n\n".join(blocks)
    n = numeric_guard_note("부모상 경조금 얼마야?", "부모상 시 경조금은 300만 원입니다.", ctx)
    assert "3,000,000원" in n  # 실측 오답(실제 50만) — 깨진 표의 값은 신뢰 불가로 경고


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
    print(f"\n✅ {len(fns)}개 테스트 통과 — P0-3 표 무결성 격리")
