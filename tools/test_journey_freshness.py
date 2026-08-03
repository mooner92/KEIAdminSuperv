#!/usr/bin/env python3
"""test_journey_freshness.py — 여정 신선도 감시(specs/13 T01) 회귀.

⛔ 픽스처는 전부 합성이다(공개 레포 데이터 분리). 검증 대상은 판정 규칙이다.
못박는 계약:
  ① 삭제 조문을 가리키면 잡는다 — 이 도구의 존재 이유
  ② **규정이 아닌 근거(ERP·가이드)는 경고하지 않는다** — 첫 실행에서 '미확인' 22건 전부가
     이 거짓 경보였다. 규정 아닌 것을 "조문이 사라졌다"고 외치면 경보 전체가 무의미해진다
  ③ 별표는 감시 못 한다는 사실을 숨기지 않는다(미감시로 계수)
실행: python tools/test_journey_freshness.py
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
mod = __import__("01k2_journey_freshness")


def _setup(tmp: Path, nodes: list, articles: dict):
    jdir = tmp / "90_관리" / "_journeys"
    jdir.mkdir(parents=True, exist_ok=True)
    (jdir / "합성여정.json").write_text(json.dumps(
        {"id": "합성여정", "title": "합성 여정", "nodes": nodes}, ensure_ascii=False), encoding="utf-8")
    idx = tmp / "index"
    idx.mkdir(exist_ok=True)
    (idx / "article_status.json").write_text(
        json.dumps({"articles": articles}, ensure_ascii=False), encoding="utf-8")
    mod.INDEX = idx


def _node(i, reg, art):
    return {"id": f"n{i}", "name": f"합성 단계 {i}", "stage": "신청",
            "근거": [{"규정명": reg, "조": art}]}


def test_deleted_article_is_caught():
    """① 삭제된 조문을 가리키는 노드 — 없는 조문을 안내 중이라는 뜻."""
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        _setup(tmp, [_node(0, "합성규정", "제5조")],
               {"합성규정#제5조": {"status": "삭제", "삭제일": "2024.03.01", "최근개정일": ""}})
        r = mod.scan(tmp, "2025-01-01")
        assert r["집계"].get("삭제") == 1, r["집계"]
        assert r["여정별"]["합성여정"]["최고심각도"] == "삭제"


def test_non_regulation_basis_is_not_warned():
    """② ERP·가이드 문서 근거는 경고 대상이 아니다(실측 거짓 경보 22건의 원인)."""
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        _setup(tmp, [_node(0, "ERP 상세가이드 · 인사(HRM)", "휴가신청상세")],
               {"합성규정#제1조": {"status": "유효", "최근개정일": ""}})
        r = mod.scan(tmp, "2025-01-01")
        assert not r["항목"], r["항목"]
        assert r["집계"].get("비규정") == 1, r["집계"]


def test_missing_article_of_known_regulation_is_flagged():
    """규정은 맞는데 그 조문이 인덱스에 없다 → 표기 오류·조문 이동 의심(진짜 확인 대상)."""
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        _setup(tmp, [_node(0, "합성규정", "제99조")],
               {"합성규정#제1조": {"status": "유효", "최근개정일": ""}})
        assert mod.scan(tmp, "2025-01-01")["집계"].get("미확인") == 1


def test_byeolji_counted_as_unmonitored():
    """③ 별표는 조문 단위가 아니라 감시 못 한다 — 조용히 넘기지 말고 계수해 드러낸다."""
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        _setup(tmp, [_node(0, "합성규정", "별표 2")],
               {"합성규정#제1조": {"status": "유효", "최근개정일": ""}})
        r = mod.scan(tmp, "2025-01-01")
        assert not r["항목"]
        assert r["커버리지"]["미감시_별표"] == 1, r["커버리지"]


def test_recent_amendment_flagged_by_since():
    """개정 판정은 기준일에 달렸다 — 날짜 형식이 섞여 있어(2026.03.03) 정규화가 전제다."""
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        arts = {"합성규정#제3조": {"status": "유효", "최근개정일": "2026.03.03"}}
        _setup(tmp, [_node(0, "합성규정", "제3조")], arts)
        assert mod.scan(tmp, "2025-08-01")["집계"].get("개정") == 1
        assert "개정" not in mod.scan(tmp, "2026-06-01")["집계"]


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
    sys.exit(1 if bad else print(f"\n✅ {len(fns)}개 통과 — 여정 신선도 감시") or 0)
