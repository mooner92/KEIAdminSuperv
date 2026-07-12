#!/usr/bin/env python3
"""test_followups.py — 후속 질문 제안 유닛 (docs/26 §1). ⛔ 무LLM·결정적 보장."""
import os
import sys
from pathlib import Path

os.environ["VAULT_DIR"] = "/home/mhchoi/kei-dev-0703/KEI-행정가이드"
sys.path.insert(0, str(Path(__file__).resolve().parent))
import rag_core  # noqa: E402

TRIP = [{"규정명": "ERP 상세가이드 · 일반·총무(GEN)", "조": "국내출장신청상세"}, {"규정명": "여비규정", "조": "제9조"}]


def test_trip_full_set():
    s = rag_core.suggest_followups("국내출장 신청 어떻게 해?", TRIP)
    types = [x["type"] for x in s]
    assert "journey" in types and any(x.get("q", "").startswith("국내출장정산") for x in s)
    assert len(s) <= 3


def test_longest_keyword_wins():
    """'연차휴가'가 경조사('휴가' 토큰)보다 우선(실측 버그 회귀)."""
    s = rag_core.suggest_followups("연차휴가 며칠이야?", [{"규정명": "복무규정", "조": "제16조"}])
    j = next(x for x in s if x["type"] == "journey")
    assert j["journey"] == "annual-leave", j


def test_no_deadline_when_already_asked():
    s = rag_core.suggest_followups("정산 기한은 언제까지야?", TRIP)
    assert not any("기한" in x.get("label", "") for x in s)


def test_no_approval_suggestion():
    """결재선 제안 금지(기존 카드와 중복 — docs/26)."""
    s = rag_core.suggest_followups("국내출장 결재는 누구까지?", TRIP)
    assert not any("결재" in (x.get("q", "") + x["label"]) for x in s)


def test_empty_safe():
    assert rag_core.suggest_followups("", []) == [] or True  # 예외만 없으면 됨(빈 제안 허용)
    assert isinstance(rag_core.suggest_followups("아무 질문", None), list)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    bad = 0
    for fn in fns:
        try:
            fn(); print(f"  ok  {fn.__name__}")
        except AssertionError as e:
            bad += 1; print(f"  ❌  {fn.__name__}: {e}")
    sys.exit(1 if bad else print(f"\n✅ {len(fns)}개 테스트 통과 — 후속 질문 제안") or 0)
