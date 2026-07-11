#!/usr/bin/env python3
"""test_value_store.py — 수치 스토어(지렛대 ③) 유닛 (docs/24 §2).

보장: ⓐ 값 질문 + 토큰 ≥2 일치 행만 조회 ⓑ 빈 스토어 no-op ⓒ 조회 블록의 값이
수치 게이트(P0-1) 허용집합에 포함(경고 없음) ⓓ 01q가 미검수 문서를 적재하지 않음.

실행: .venv/bin/python tools/test_value_store.py  (모델 미로딩 — 순수 로직)
"""
import json
import os
import sys
import tempfile
from pathlib import Path

TMP = tempfile.mkdtemp(prefix="kei-vs-")
STORE = os.path.join(TMP, "value_store.json")
os.environ["RAG_VALUE_STORE_PATH"] = STORE

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rag_core  # noqa: E402

FIXTURE = {"rows": [
    {"규정명": "여비규정", "파일": "20_규정원문/4300_여비규정.md", "표": "구분 / 숙박비 (1박당) / 식비",
     "행": "제5호 내지 제6호", "열": "숙박비 (1박당)", "값": "특별시 100,000, 광역시 80,000"},
    {"규정명": "상조회규약", "파일": "20_규정원문/상조회규약.md", "표": "지급구분 / 경조금",
     "행": "사망 · 본인 및 배우자의 부모", "열": "경조금", "값": "500,000원"},
]}


def _load_fixture():
    Path(STORE).write_text(json.dumps(FIXTURE, ensure_ascii=False), encoding="utf-8")
    rag_core._state.pop("value_store", None)


def test_empty_store_noop():
    Path(STORE).write_text('{"rows": []}', encoding="utf-8")
    rag_core._state.pop("value_store", None)
    assert rag_core._value_store_lookup("숙박비 상한 얼마야?") == []


def test_value_question_matches():
    _load_fixture()
    got = rag_core._value_store_lookup("여비규정 숙박비 상한 얼마야?")
    assert got and got[0][0]["규정명"] == "여비규정" and "100,000" in got[0][0]["값"]


def test_low_overlap_no_match():
    _load_fixture()
    assert rag_core._value_store_lookup("연차휴가 절차 알려줘") == []  # 스토어 라벨과 무관


def test_condolence_row_matches():
    _load_fixture()
    got = rag_core._value_store_lookup("부모 사망 경조금 얼마?")
    assert got and got[0][0]["규정명"] == "상조회규약"


def test_gate_allows_store_values():
    """조회 블록 형식의 값은 P0-1 허용집합에 포함 — 인용 시 경고가 붙지 않는다(수용기준 ⓒ)."""
    _load_fixture()
    row = FIXTURE["rows"][1]
    block = (f"[{row['규정명']} {row['열']} · 수치 스토어(검수 완료 표에서 결정적 조회)]\n"
             f"행: {row['행']}\n열: {row['열']}\n값: {row['값']}")
    n = rag_core.numeric_guard_note("부모상 경조금 얼마?", "부모상 경조금은 500,000원입니다.", block)
    assert n == "", n


def test_01q_skips_unreviewed():
    """01q: 검수상태가 '검수완료'가 아니면 표가 아무리 멀쩡해도 적재 금지."""
    vault = Path(TMP) / "vault"
    (vault / "20_규정원문").mkdir(parents=True, exist_ok=True)
    (vault / "20_규정원문" / "테스트규정.md").write_text(
        "---\ntype: regulation\n규정명: 테스트규정\n검수상태: 미검수\n---\n"
        "| 구분 | 금액 |\n| --- | --- |\n| 수수료 | 5,000원 |\n", encoding="utf-8")
    import subprocess
    out = os.path.join(TMP, "out.json")
    r = subprocess.run([sys.executable, str(Path(__file__).parent / "01q_table_store.py"),
                        "--vault", str(vault), "--out", out], capture_output=True, text=True,
                       env={**os.environ, "PYTHONPATH": str(Path(__file__).parent)})
    # 01q는 고정 경로(tools/index)에 쓰므로 여기선 stdout 판정만(0문서·미검수 제외 1)
    assert "0개 검수완료 문서에서 0행" in r.stdout, r.stdout


if __name__ == "__main__":
    fns = [test_empty_store_noop, test_value_question_matches, test_low_overlap_no_match,
           test_condolence_row_matches, test_gate_allows_store_values, test_01q_skips_unreviewed]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"  ok  {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  ❌  {fn.__name__}: {e}")
    import shutil
    shutil.rmtree(TMP, ignore_errors=True)
    if failed:
        sys.exit(1)
    print(f"\n✅ {len(fns)}개 테스트 통과 — 수치 스토어(지렛대 ③)")
