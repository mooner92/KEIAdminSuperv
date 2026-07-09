#!/usr/bin/env python3
"""test_sys_attribution.py — P0-4 시스템 귀속 백스톱 유닛 (docs/22 §4).

실측(temp 0.1 변동): '문서수발'(그룹웨어 모듈)을 ERP/전자결재에 오귀속.
적대 리뷰 반영: 후행 정귀속 시 경고 억제, 모듈명 자기포함 시스템 토큰 무시.

실행: .venv/bin/python tools/test_sys_attribution.py  (모델 미로딩 — 순수 로직)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rag_core import system_attribution_note  # noqa: E402

SRC = [{"type": "system", "규정명": "그룹웨어 · 문서수발"}]


def test_misattribution_detected():
    n = system_attribution_note("공문은 ERP 시스템의 문서수발 메뉴에서 처리합니다.", SRC)
    assert "그룹웨어" in n and "문서수발" in n


def test_correct_attribution_silent():
    assert system_attribution_note("공문은 그룹웨어의 문서수발 메뉴에서 처리합니다.", SRC) == ""


def test_later_correct_mention_suppresses():
    """리뷰: 첫 창엔 타 시스템만 있어도, 다른 곳에서 올바르게 귀속했으면 경고하지 않는다."""
    a = ("문서수발과 웹디스크 자료실을 함께 확인하세요. 자세한 것은 아래와 같습니다.\n"
         "문서수발 메뉴는 그룹웨어에 있습니다.")
    assert system_attribution_note(a, SRC) == ""


def test_self_contained_system_token_ignored():
    """리뷰: 모듈명('전자결재 기안')에 포함된 시스템 토큰('전자결재')은 오귀속 신호가 아니다."""
    src = [{"type": "system", "규정명": "그룹웨어 · 전자결재 기안"}]
    a = "휴가 신청은 전자결재 기안 화면에서 결재를 상신하면 됩니다."
    assert system_attribution_note(a, src) == ""


def test_non_system_sources_ignored():
    assert system_attribution_note("문서수발은 ERP에서.", [{"type": "regulation", "규정명": "복무규정"}]) == ""


def test_empty_safe():
    assert system_attribution_note("", SRC) == ""
    assert system_attribution_note("아무 내용", None) == ""


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
    print(f"\n✅ {len(fns)}개 테스트 통과 — P0-4 시스템 귀속 백스톱")
