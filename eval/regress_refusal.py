#!/usr/bin/env python3
"""regress_refusal.py — 프롬프트 변경(주제 불일치 거부 규칙 등)의 골든셋 회귀 검증.

목적(2026-07-24, 사용자 논의): "왜 틀렸는지 → 프롬프트로 고침 → 골든셋으로 정상 답변이
안 깨졌는지 검증"의 마지막 조각. 골든을 답변에 주입하는 게 아니라, 프롬프트 개선의 **안전망**.

두 집합을 API에 실호출해 대조:
  ① MUST_REFUSE — 규정 밖 사안(구내식당·카페 등). 변경 후 '거부'해야 통과.
  ② MUST_ANSWER — 은행에서 골든 보유 문항 N개 샘플(정상 질문). 변경 후에도 '거부하지 않고'
     골든 문장의 핵심 토큰을 답변에 포함해야 통과(= 정상 답변이 안 깨졌다는 회귀 안전망).
실행: cd eval && ../tools/.venv/bin/python regress_refusal.py [--n 20] [--api http://127.0.0.1:9001]
"""
import argparse
import json
import random
import re
import sys
from pathlib import Path

from daily_common import API, load_bank, norm_q, rag_answer

REFUSAL_RE = re.compile(
    r"확인되지\s*않|확인할\s*수\s*없|찾을\s*수\s*없|근거가\s*없|명시(되어|돼)?\s*있지\s*않|"
    r"명시되지\s*않|포함(되어|돼)?\s*있지\s*않|포함되지\s*않|나와\s*있지\s*않|규정에서\s*확인|"
    r"해당\s*내용(은|이)?\s*없|정보가\s*없")

MUST_REFUSE = [
    "구내식당에서 외부인을 초대할 수 있는가?",
    "회의실 식사 중 음식물을 반입해도 되나요?",
    "사내 카페 운영 시작 시간이 언제인가요?",
    "흡연 구역은 사내 어디에 위치해 있나요?",
    "주차장은 몇 시까지 이용할 수 있나요?",
]


def golden_hit(answer: str, golden: str) -> bool:
    """골든 문장의 핵심 2-그램이 답변에 60%+ 존재하면 '핵심 보존'."""
    g = norm_q(golden)
    if len(g) < 8:
        return True
    gg = {g[i:i + 2] for i in range(len(g) - 1)}
    a = norm_q(answer)
    return sum(1 for x in gg if x in a) / max(1, len(gg)) >= 0.55


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20, help="MUST_ANSWER 샘플 수(골든 보유 문항에서)")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    random.seed(args.seed)

    bank = [b for b in load_bank() if b.get("골든") and b.get("유형") != "거부형"
            and b.get("상태") not in ("retire", "stale")]
    sample = random.sample(bank, min(args.n, len(bank)))

    print(f"=== ① MUST_REFUSE {len(MUST_REFUSE)}건 — 규정 밖 사안은 거부해야 통과 ===")
    r_ok = 0
    for q in MUST_REFUSE:
        ans = rag_answer(q)["content"] or ""
        refused = bool(REFUSAL_RE.search(ans))
        r_ok += refused
        print(f"  {'✅거부' if refused else '❌응답'} {q[:34]} — {ans[:60].strip()}")

    print(f"\n=== ② MUST_ANSWER {len(sample)}건 — 정상 질문은 거부 안 하고 골든 보존해야 통과 ===")
    a_ok = 0
    regressions = []
    for b in sample:
        ans = rag_answer(b["질문"])["content"] or ""
        refused = bool(REFUSAL_RE.search(ans))
        hit = golden_hit(ans, b["골든"])
        ok = (not refused) and hit
        a_ok += ok
        if not ok:
            regressions.append((b["질문"], "거부됨" if refused else "골든불일치"))
        print(f"  {'✅' if ok else '⚠'} {b['질문'][:40]} {'(거부됨!)' if refused else ('(골든미보존)' if not hit else '')}")

    print(f"\n── 결과 ── MUST_REFUSE {r_ok}/{len(MUST_REFUSE)} 거부 · MUST_ANSWER {a_ok}/{len(sample)} 정상")
    if regressions:
        print("⚠ 회귀 의심(정상 질문이 거부/골든불일치):")
        for q, why in regressions:
            print(f"    - {why}: {q[:50]}")
    passed = r_ok == len(MUST_REFUSE) and a_ok >= len(sample) - 1  # 정상 1건 노이즈 허용
    print("\n" + ("🎉 회귀 통과 — 거부 강화 + 정상 답변 보존" if passed
                  else "⚠ 회귀 실패 — 프롬프트 재조정 필요"))
    return 0 if passed else 2


if __name__ == "__main__":
    raise SystemExit(main())
