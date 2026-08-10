#!/usr/bin/env python3
"""test_gate_summary.py — x_gates 텔레메트리 회귀 (specs/16 W1-E).

⛔ 픽스처는 전부 합성. 이 함수는 답변 텍스트를 절대 바꾸지 않는 **순수 요약**이며,
   인용 대조의 허용집합은 x_sources가 아니라 **컨텍스트+태그**다 — 조문 상호참조 854건
   (clause_xref 실측)·impact 목록 오탐(FP-B·FP-C)을 피하는 것이 설계의 절반이다.
실행: cd tools && .venv/bin/python test_gate_summary.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rag_core import gate_summary  # noqa: E402

CTX = ("[합성규정 제3조]\n제3조(합성) ① 합성한다. 제6조의2에 따라 처리한다.\n\n"
       "[합성규정 별표 2]\n구분 | 기준\n")
SRC = [{"tag": "합성규정 제3조", "defterm_route": True},
       {"tag": "합성규정 별표 2", "graph_expand": True, "절단": True}]


def test_matched_citation_not_counted():
    """컨텍스트에 있는 인용(규정명·조 각각 확인)은 unmatched가 아니다."""
    g = gate_summary("**답.** [합성규정 제3조]", CTX, SRC)
    assert g["cite_total"] == 1 and g["cite_unmatched"] == 0, g


def test_fabricated_regulation_is_counted():
    """8/7 실표적 재현 — 컨텍스트에 규정명 자체가 없는 인용은 unmatched."""
    g = gate_summary("**답.** [개인정보 보호법 제25조]", CTX, SRC)
    assert g["cite_unmatched"] == 1, g
    assert "개인정보 보호법" in g["cite_unmatched_list"][0], g


def test_cross_reference_in_context_body_is_matched():
    """FP-B 회피 증명 — 본문에만 등장하는 제6조의2 인용(x_sources엔 없음)은 오탐하지 않는다."""
    g = gate_summary("**답.** [합성규정 제6조의2]", CTX, SRC)
    assert g["cite_unmatched"] == 0, g


def test_annex_spacing_normalized():
    """`별표 2`/`별표2` 공백 차이는 매칭에 영향 없다(SYSTEM 예시와 메타 표기가 다름 — 실측)."""
    for cite in ("[합성규정 별표 2]", "[합성규정 별표2]"):
        g = gate_summary(f"**답.** {cite}", CTX, SRC)
        assert g["cite_unmatched"] == 0, (cite, g)


def test_non_citation_brackets_ignored():
    """[근거]·[참고] 같은 비인용 대괄호는 세지 않는다(조/별표 토큰 없는 대괄호 제외)."""
    g = gate_summary("[근거] 에 따르면 가능합니다. [참고]", CTX, SRC)
    assert g["cite_total"] == 0, g


def test_routes_and_truncation_aggregated():
    """라우트 truthy 집계 + 절단 불리언 — 발동률·절단율 측정의 원료(docs/69 R2 복원)."""
    g = gate_summary("답", CTX, SRC)
    assert g["routes"] == {"defterm_route": 1, "graph_expand": 1}, g["routes"]
    assert g["절단"] is True, g


def test_never_raises_on_garbage():
    """텔레메트리 실패가 답변을 막으면 안 된다 — 어떤 입력에도 dict를 돌려준다."""
    g = gate_summary(None, None, [{"tag": None}, "이상한값"])
    assert set(g) == {"routes", "절단", "cite_total", "cite_unmatched", "cite_unmatched_list"}, g


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
    sys.exit(1 if bad else print(f"\n✅ {len(fns)}개 통과 — x_gates 텔레메트리") or 0)
