#!/usr/bin/env python3
"""test_golden_binding.py — 골든↔청크 재바인딩 회귀 (2026-08-20 수술).

배경(실측): `daily_gen.py --sync`가 "겹침 0.8 넘는 **첫 청크**"에 골든을 묶는 바람에
판별 토큰만 다른 이웃 청크가 선택돼 시험지가 자기모순이 됐다 — 골든은 "심각 단계 비상대기
필수"인데 참고 원문은 "경계 단계 …"라, 답이 맞아도 채점기가 오답을 준다(재채점 13/13 오답).

⛔ 순수 함수만 호출한다(Chroma·LLM·은행 접근 없음). 회차 파일도 건드리지 않는다.
실행: cd eval && ../tools/.venv/bin/python test_golden_binding.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from daily_common import norm_q  # noqa: E402
from daily_gen import BIND_MIN_OVERLAP, pick_chunk  # noqa: E402

ok = fail = 0


def check(name, got, want):
    global ok, fail
    if got == want:
        ok += 1
        print(f"  ✅ {name}")
    else:
        fail += 1
        print(f"  ❌ {name}: got={got!r} want={want!r}")


def nd(**kw):
    return {k: norm_q(v) for k, v in kw.items()}


print("골든↔청크 재바인딩 회귀")

# ① 실측 재생 — 사이버위기대응실무매뉴얼 #679(경계·겹침 0.85) vs #681(심각·정확포함)
GOLDEN = '※ 모든 유지보수업체 담당자는 “심각” 단계에서는 비상대기 필수'
docs = nd(
    c679='※ 모든 유지보수업체 담당자는 “경계“ 단계에서는 비상대기(유선, 상주) 필수\n'
         '  라. 심  각     *  경계 단계의 대응조치 지속',
    c681='※ 모든 유지보수업체 담당자는 “심각” 단계에서는 비상대기 필수\n\n| 서식 #1~#5 |',
)
# 이웃 청크가 후보 순서상 먼저 와도(구 규칙의 break 지점) 정확포함 쪽을 골라야 한다
check("실측 037p — 정확포함 청크 채택", pick_chunk(GOLDEN, ["c679", "c681"], docs, "c679"), "c681")
check("실측 037p — 후보 순서 반대여도 동일", pick_chunk(GOLDEN, ["c681", "c679"], docs, None), "c681")
# 구 규칙이었다면 c679가 나온다 — 그 전제(0.8은 넘는다)를 고정해 둔다
ng = norm_q(GOLDEN)
gg = {ng[i:i + 2] for i in range(len(ng) - 1)}
ov679 = sum(1 for x in gg if x in docs["c679"]) / len(gg)
check("이웃 청크가 임계를 넘는다는 전제(구 결함 재현 조건)", ov679 >= BIND_MIN_OVERLAP, True)

# ② 정확포함이 없으면 겹침 **최대**(첫 히트 아님)
d2 = nd(a="가나다라마바사 아자차카", b="가나다라마바사 아자차카타파하 추가문장")
G2 = "가나다라마바사 아자차카타파하"
check("정확포함 없음 → 최대 겹침", pick_chunk(G2, ["a", "b"], d2, None), "b")

# ③ 동점이면 현행 유지(재색인마다 바인딩이 흔들리지 않게)
d3 = nd(x="같은 문장이 두 청크에 있다", y="같은 문장이 두 청크에 있다")
check("동점 → 현행 유지", pick_chunk("같은 문장이 두 청크에 있다", ["x", "y"], d3, "y"), "y")
check("동점 + 현행 없음 → 첫 후보", pick_chunk("같은 문장이 두 청크에 있다", ["x", "y"], d3, None), "x")

# ④ 아무 후보도 임계 미만 → None(호출부가 stale 처리 = 개정 의심)
d4 = nd(z="전혀 관계 없는 다른 조문 본문입니다")
check("전부 임계 미만 → None(stale)", pick_chunk("완전히 다른 골든 문장 내용", ["z"], d4, "z"), None)

# ⑤ 빈 골든·빈 후보 방어
check("골든 빈칸 → None", pick_chunk("", ["a"], d2, None), None)
check("후보 없음 → None", pick_chunk(G2, [], d2, None), None)

print(f"\n{ok} 통과 · {fail} 실패")
sys.exit(1 if fail else 0)
