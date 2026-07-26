#!/usr/bin/env python3
"""test_impact_analytics.py — 조문 단위 개정 파급(specs/05 D1) 회귀.
실사례 기반: conflict_audit(2026-07-13)이 잡은 낙후·이본 사태가 '파급 후보'로 떠야 한다."""
import json
import pathlib
import sys

I = pathlib.Path(__file__).resolve().parent / "index"
g = json.loads((I / "graph_analytics.json").read_text(encoding="utf-8"))
ai = g.get("impact_by_article", {})

CASES = [
    # (조키, 필드, 반드시 포함되어야 할 항목(부분일치), 사유)
    ("인사규정#제31조", "direct", "보수규정", "conflict_audit: 31조의2 삭제가 보수규정 서술에 파급"),
    ("복무규정#제19조", "guides", "KEI휴가의모든것", "휴가 가이드는 연차 조문을 인용"),
    ("복무규정#제19조", "deadlines", "이내", "청원휴가류 기한이 이 조 계열에 걸림"),
    ("여비규정#제16조", "forms", "별표", "여비 지급 기준은 별표 참조"),
    ("여비규정#제16조", "direct", "국외출장 운영 가이드", "국외출장 가이드 제33조가 준용"),
]


def main() -> int:
    bad = 0
    if not ai:
        print("❌ impact_by_article 없음 — 01l을 --vault와 함께 실행했는지 확인")
        return 1
    print(f"파급 조문 {len(ai)}개")
    for key, field, needle, why in CASES:
        vals = ai.get(key, {}).get(field, [])
        ok = any(needle in str(v) for v in vals)
        bad += not ok
        print(f"  {'✅' if ok else '❌'} {key} .{field} ⊇ '{needle}' ({why})")
    # 구조 불변식: 순환 없음(자기 자신이 파급 목록에 없음) · 깊이 가드
    self_ref = [k for k, v in ai.items() if k in v.get("direct", []) + v.get("transitive", [])]
    print(f"  {'✅' if not self_ref else '❌'} 자기참조 0건 (실측 {len(self_ref)})")
    bad += bool(self_ref)
    print("\n" + ("🎉 통과" if not bad else f"⚠ {bad}건 실패"))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
