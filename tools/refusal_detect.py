"""refusal_detect.py — 거부 답변 판정 단일 정본 (specs/01 Phase 0, 2026-07-24).

배경(실측, docs/62 T9): 기존 REFUSAL_RE가 4곳(daily_grade·regress_refusal·ab_model_test·
app_api)에 복제된 채 문맥을 안 봐 두 가지 거짓 양성을 냈다 —
  ① '규정에서\\s*확인' 이 "규정에서 확인**된** 총 4,399건"(긍정문)까지 매칭
  ② 정답 결론 + 꼬리 부가 안내("서식 내용은 근거에 명시되지 않아 원문 확인 바랍니다")를
     전체 스캔이 거부로 집계 — 부가 안내는 오히려 정직성(⛔절대규칙1) 준수 행동이다.

설계: SYSTEM 규약이 **두괄식(첫 줄 굵은 핵심 결론)**이므로, 거부 판정은 **결론부에서만** 한다.
  · is_refusal(text): 결론부(첫 문단 또는 head_chars) 내 거부 표현 → True
  · 패턴은 전부 부정형으로 한정('확인되지 않', '규정에서 확인되지 않' 등) — 긍정문 오매칭 제거
⛔ 이 모듈은 측정기(채점·통계) 전용 — RAG 답변 생성 경로(SYSTEM·가드레일)와 무관.
"""
import re

# 거부 표현 — 전부 부정형. ('규정에서 확인' 단독 금지: 긍정문 "규정에서 확인된"과 충돌 — T9)
# 피동형(명시되지)+능동형(명시하지) 모두 — 실측: "근거에서는 …를 명시하지 않습니다"(2026-07-25).
REFUSAL_RE = re.compile(
    r"확인되지\s*않|확인할\s*수\s*없|찾을\s*수\s*없|근거가\s*없|"
    r"명시(되어|돼)?\s*있지\s*않|명시[되하]지\s*않|포함(되어|돼)?\s*있지\s*않|포함[되하]지\s*않|"
    r"나와\s*있지\s*않|규정(되어|돼)?\s*있지\s*않|규정[되하]지\s*않|언급[되하]지\s*않|"
    r"규정에서\s*확인되지\s*않|해당\s*내용(은|이)?\s*없|정보가\s*없|알\s*수\s*없")

HEAD_CHARS = 200  # 두괄식 결론부 근사 — 첫 굵은 결론 문장이 이 안에 들어온다(실측 표본 기준)


def _head(text: str, head_chars: int = HEAD_CHARS) -> str:
    """결론부 추출 — 첫 빈 줄(문단 경계)까지, 없으면 head_chars.
    SYSTEM 두괄식 규약상 결론은 첫 문단(굵은 첫 줄)에 온다."""
    t = (text or "").strip()
    para = t.split("\n\n", 1)[0]
    # 첫 문단이 너무 길면(리스트 연속 등) head_chars로 캡, 너무 짧으면(제목 한 줄) head_chars 보충
    if len(para) < 40:
        return t[:head_chars]
    return para[:max(head_chars, 0)] if head_chars else para


def is_refusal(text: str, head_chars: int = HEAD_CHARS) -> bool:
    """결론부 기준 거부 판정. 꼬리 부가 안내('~는 명시되지 않아 원문 확인')는 거부로 안 침."""
    return bool(REFUSAL_RE.search(_head(text, head_chars)))


def is_refusal_anywhere(text: str) -> bool:
    """전체 스캔(구 동작) — 회귀 비교·디버그용. 신규 코드는 is_refusal을 쓸 것."""
    return bool(REFUSAL_RE.search(text or ""))
