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

from daily_common import API, ROOT, load_bank, norm_q, rag_answer

sys.path.insert(0, str(ROOT / "tools"))
from refusal_detect import is_refusal  # 단일 정본(specs/01 P0) — 결론부 스코프+부정형 한정(T9)

MUST_REFUSE = [
    "구내식당에서 외부인을 초대할 수 있는가?",
    "회의실 식사 중 음식물을 반입해도 되나요?",
    "사내 카페 운영 시작 시간이 언제인가요?",
    "흡연 구역은 사내 어디에 위치해 있나요?",
    "주차장은 몇 시까지 이용할 수 있나요?",
    # 2026-07-26 추가 — 감사로 '코퍼스 무언급' 확인한 주제(audit_refusal_seeds.py)
    "사내 편의점에서 직원 할인을 받을 수 있나요?",
    "무인 택배함은 어떻게 이용하나요?",
]

# 규정이 **실제로 규율하는데** 거부하면 안 되는 것(과잉 거부 감시).
# 2026-07-26 실측: '탕비실 커피머신 수리'는 거부형 시드였지만 물품 지침 제15조가 규율한다 —
# 모델이 정확히 인용해 답했는데 오답으로 집계됐다. 시드에서 빼면서 **반대 방향 회귀**로 편입한다.
MUST_NOT_REFUSE = [
    ("탕비실에 있는 커피머신이 고장 났는데 수리 요청은 어떻게 하나요?", ["수리", "주관부서"]),
    ("사무용 물품을 구매하려면 어떤 절차를 밟아야 하나요?", ["부서장", "주관부서"]),
]


# 골든 보존 판정의 노이즈 축(2026-07-25 실측): 답변이 **정확한데도** 표현을 다듬으면
# 2-그램 보존률이 임계 근처로 떨어져 거짓 회귀가 난다(예: 임금피크 연차 문항 54% vs 임계 55%
# — 답변은 근거·결론 모두 정확). 순수 2-그램은 "같은 말을 다르게 쓴 것"에 취약하다.
# ⟹ 두 축 중 **하나만 만족해도 보존**으로 본다:
#    ① 2-그램 보존률 ≥ COVER_MIN(느슨하게 0.5)
#    ② **핵심어 보존**: 골든에서 뽑은 내용어(숫자·2자+ 명사구)의 80%+가 답변에 존재
#       — 조사·어미 차이에 둔감하고, 값·고유어가 빠지면 여전히 잡아낸다.
COVER_MIN = 0.5
KEY_MIN = 0.8
_STOP = {"경우", "때에", "때는", "대하여", "관하여", "따라", "따른", "등의", "등을", "있다", "한다",
         "하는", "하여", "되는", "위한", "이하", "다음", "각호", "각목", "제항", "그리고", "또는"}


def _keywords(text: str) -> set:
    """내용어 근사 — 숫자 토큰 + 2자 이상 한글/영문 덩어리(불용어 제외)."""
    toks = set(re.findall(r"\d[\d,.]*|[가-힣A-Za-z]{2,}", text or ""))
    return {t for t in toks if t not in _STOP}


def golden_hit(answer: str, golden: str) -> bool:
    """골든의 핵심이 답변에 남아 있는가 — 2-그램 또는 핵심어 중 하나만 만족해도 보존."""
    g = norm_q(golden)
    if len(g) < 8:
        return True
    gg = {g[i:i + 2] for i in range(len(g) - 1)}
    a = norm_q(answer)
    cover = sum(1 for x in gg if x in a) / max(1, len(gg))
    if cover >= COVER_MIN:
        return True
    keys = _keywords(golden)
    if not keys:
        return False
    hit = sum(1 for k in keys if k in (answer or ""))
    return hit / len(keys) >= KEY_MIN


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20, help="MUST_ANSWER 샘플 수(골든 보유 문항에서)")
    ap.add_argument("--skip-notrefuse", action="store_true", help="MUST_NOT_REFUSE 축 생략")
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
        refused = is_refusal(ans)
        r_ok += refused
        print(f"  {'✅거부' if refused else '❌응답'} {q[:34]} — {ans[:60].strip()}")

    print(f"\n=== ② MUST_ANSWER {len(sample)}건 — 정상 질문은 거부 안 하고 골든 보존해야 통과 ===")
    a_ok = 0
    regressions = []
    for b in sample:
        ans = rag_answer(b["질문"])["content"] or ""
        refused = is_refusal(ans)
        hit = golden_hit(ans, b["골든"])
        ok = (not refused) and hit
        a_ok += ok
        if not ok:
            regressions.append((b["질문"], "거부됨" if refused else "골든불일치"))
        print(f"  {'✅' if ok else '⚠'} {b['질문'][:40]} {'(거부됨!)' if refused else ('(골든미보존)' if not hit else '')}")

    # ③ 과잉 거부 감시 — 규정이 실제로 규율하는데 거부하면 회귀
    n_ok = n_tot = 0
    if not args.skip_notrefuse:
        print(f"\n=== ③ MUST_NOT_REFUSE {len(MUST_NOT_REFUSE)}건 — 규정이 규율하는 사안은 답해야 통과 ===")
        for q, keys in MUST_NOT_REFUSE:
            n_tot += 1
            ans = rag_answer(q)["content"] or ""
            ok = not is_refusal(ans) and any(k in ans for k in keys)
            n_ok += ok
            print(f"  {'✅응답' if ok else '❌거부/누락'} {q[:34]} — {ans[:60].strip()}")

    print(f"\n── 결과 ── MUST_REFUSE {r_ok}/{len(MUST_REFUSE)} 거부 · MUST_ANSWER {a_ok}/{len(sample)} 정상"
          + (f" · MUST_NOT_REFUSE {n_ok}/{n_tot} 응답" if n_tot else ""))
    if regressions:
        print("⚠ 회귀 의심(정상 질문이 거부/골든불일치):")
        for q, why in regressions:
            print(f"    - {why}: {q[:50]}")
    passed = (r_ok == len(MUST_REFUSE) and a_ok >= len(sample) - 1  # 정상 1건 노이즈 허용
              and (n_tot == 0 or n_ok == n_tot))
    print("\n" + ("🎉 회귀 통과 — 거부 강화 + 정상 답변 보존" if passed
                  else "⚠ 회귀 실패 — 프롬프트 재조정 필요"))
    return 0 if passed else 2


if __name__ == "__main__":
    raise SystemExit(main())
