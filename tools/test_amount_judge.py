#!/usr/bin/env python3
"""test_amount_judge.py — 금액 룰 엔진(specs/06) 경계값 중심 회귀.
정답표 = 위임전결규정 별표 원문(01n approval.json) 수동 대조."""
import sys

from amount_judge import find_tasks, judge, parse_amount

K_GAJI = "3.예산집행 > 가.원인행위 > 1) 가지급금집행"
K_CARD = "3.예산집행 > 가.원인행위 > 4) 업무추진비집행(현금 및 법인카드)"
K_JIchul = [k for k in __import__("amount_judge")._rules() if "지출결의서" in k][0]

CASES = [
    # (업무키, 금액, 기대 전결권자, 설명)
    (K_GAJI, 2_000_000, "실･팀장", "경계: 200만원 '이하'는 포함"),
    (K_GAJI, 2_000_001, "부서장/센터장", "경계+1: 초과 구간 시작"),
    (K_GAJI, 3_700_000, "부서장/센터장", "스펙 예제: 가지급금 370만원"),
    (K_GAJI, 10_000_000, "부서장/센터장", "경계: 1,000만원 이하 포함"),
    (K_GAJI, 10_000_001, "부원장", "경계+1"),
    (K_GAJI, 30_000_001, "원장", "상한 개방 구간"),
    (K_CARD, 300_000, "실･팀장", "업무추진비 30만원 이하"),
    (K_CARD, 300_001, "부서장/센터장", "30만 초과~50만 이하"),
    (K_CARD, 600_000, "부원장", "50만원 초과(실충돌 사례 금액대)"),
    (K_JIchul, 1_500_000, "과제책임자", "사다리 절단: 200만 이하 최하위"),
    (K_JIchul, 5_000_000, "팀장", "사다리 절단: 200만 초과~1,000만 이하"),
    (K_JIchul, 20_000_000, "부서장", "사다리: 1,000만 초과"),
]


def main() -> int:
    bad = 0
    for key, amt, want, why in CASES:
        r = judge(key, amt)
        got = r.get("전결권자", f"({r.get('상태')})")
        # 별표 원문 표기의 공백은 판정과 무관('과제 책임자' == '과제책임자') — 비교만 정규화한다.
        ok = got.replace(" ", "") == want.replace(" ", "")
        bad += not ok
        print(f"  {'✅' if ok else '❌'} {amt:>12,}원 → {got:12} (기대 {want}) — {why}")
    # 판정불가 정직성
    r = judge("없는 업무", 1)
    ok = r["상태"] == "판정불가"
    print(f"  {'✅' if ok else '❌'} 미등록 업무 → 판정불가(근사 금지)")
    bad += not ok
    # 금액 파서
    for txt, want in [("가지급금 370만원 집행", 3_700_000), ("3억 계약", 300_000_000),
                      ("제31조가 뭐야", None), ("1,000만 원 이하", 10_000_000)]:
        got = parse_amount(txt)
        ok = got == want
        bad += not ok
        print(f"  {'✅' if ok else '❌'} parse '{txt}' → {got} (기대 {want})")
    # 업무 탐색
    ks = find_tasks("법인카드로 업무추진비 40만원 결제")
    ok = ks and "업무추진비" in ks[0]
    bad += not ok
    print(f"  {'✅' if ok else '❌'} find_tasks(법인카드 업무추진비) → {ks[:1]}")
    print("\n" + ("🎉 전부 통과" if not bad else f"⚠ {bad}건 실패"))
    return 0 if not bad else 1


def test_resolve_tie():
    """동점 tie-break — 변별 토큰이 한 후보에만 있으면 특정, 둘 다면 모호 유지(2026-08-14)."""
    import amount_judge as aj
    q = "매각 건으로 126만원을 집행하려는데 전결권자는 누구인가요?"
    k = aj.resolve_tie(aj.find_tasks_scored(q), q)
    assert k and "매각" in k.rsplit(">", 1)[-1], f"매각을 특정 못 함: {k}"
    assert aj.judge(k, aj.parse_amount(q))["전결권자"].replace(" ", "") == "실･팀장"
    q2 = "물품 구입과 매각 500만원은 누가 전결하나요?"   # 반대 leaf 동시 언급 = 찍으면 안 됨
    assert aj.resolve_tie(aj.find_tasks_scored(q2), q2) is None


if __name__ == "__main__":
    sys.exit(main())
