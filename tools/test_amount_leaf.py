#!/usr/bin/env python3
"""test_amount_leaf.py — 금액 전결 판정의 **업무 특정** 회귀 (docs/63 §12).

배경: 별표에는 한 상위업무 밑에 서로 반대인 leaf가 붙는다
      `… 물품구입 및 매각(도서포함) > 구입`  /  `… > 매각`
경로의 대부분이 겹치므로, 점수를 경로 전체로만 매기면 둘이 사실상 동점이 되고
**구입을 물었는데 매각 판정**이 나간다. rag_core는 tasks[0]으로 단정 판정을 내보내므로
이건 '못 찾음'이 아니라 **확신에 찬 오답**이다(⛔절대 규칙 1 — 회계 오답은 실제 사고).

지키는 계약:
  ① leaf 구분: '구입' 질문은 구입, '매각' 질문은 매각이 1위
  ② 짧은 표현 수용: '물품'이 없어도 '매각'만으로 찾힌다
  ③ 모호하면 단정하지 않는다: leaf를 특정 못 하면 후보를 좁히지 말고 알린다
  ④ 기존 동작 보존: 법인카드 업무추진비 등 단일 업무는 그대로
"""
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])

from amount_judge import find_tasks, parse_amount  # noqa: E402

# (질의, 1위 업무경로에 반드시 있어야 할 조각, 절대 있으면 안 될 조각)
CASES = [
    # ① leaf 구분 — 같은 상위업무 아래 반대 leaf
    ("도서 300만원어치 구입하려면 전결권자가 누구야", "구입", "매각"),
    ("618만원짜리 물품 매각은 누가 전결이야?", "매각", None),
    ("물품 구입 500만원 전결", "구입", "매각"),
    ("물품 매각 500만원 전결", "매각", None),
    # ② 짧은 표현 — '물품' 없이도 찾혀야 한다
    ("중고 장비 618만원에 매각할 때 결재", "매각", None),
    ("책 200만원어치 구입 결재선", "구입", "매각"),
    # ④ 기존 동작 보존
    ("법인카드로 업무추진비 40만원 결제", "업무추진비", None),
]


def main() -> int:
    bad = 0
    for q, want, forbid in CASES:
        ks = find_tasks(q)
        top = ks[0] if ks else ""
        ok = bool(ks) and want in top and (forbid is None or forbid not in top.rsplit(">", 1)[-1])
        bad += not ok
        mark = "✅" if ok else "❌"
        tail = top.rsplit(">", 1)[-1].strip() if top else "(후보 없음)"
        print(f"  {mark} {q[:34]:36} → {tail}")
        if not ok and top:
            print(f"      기대 '{want}' 포함 / '{forbid}' 아님 — 실제: {top}")

    # ③ 모호성: 금액이 없으면 판정 경로를 타지 않아야 한다(파서 계약)
    ok = parse_amount("물품 매각 전결이 누구야") is None
    bad += not ok
    print(f"  {'✅' if ok else '❌'} 금액 없는 질문은 parse_amount=None (판정 라우팅 미발동)")

    print(f"\n{'🎉 전부 통과' if not bad else f'⚠ {bad}건 실패'} ({len(CASES) + 1}건)")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
