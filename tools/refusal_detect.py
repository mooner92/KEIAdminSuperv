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
    r"규정에서\s*확인되지\s*않|해당\s*내용(은|이)?\s*없|정보가\s*없|알\s*수\s*없|"
    # 2026-07-27 실측: "…확인된 근거에서 규정이 없습니다"(사내 도서관 야간 질의)가 정상 거부인데
    # 오답으로 집계됐다. '없다' 계열 중 **못 찾았다**는 뜻인 어형만 좁게 추가한다.
    # ⛔ 맨 '규정이 없' 은 금지 — "제한하는 규정이 없어 가능합니다"(허용 결론)까지 삼킨다(T7 계열 재발).
    r"명시(적|된)?[인]?\s*(규정|기준|근거|내용|조항)(은|는|이|가)?\s*없|"
    r"(관련|해당|별도|구체적)[인]?\s*(규정|기준|근거|조항|절차)(은|는|이|가)?\s*없|"
    r"근거에서\s*(규정|기준|내용)(은|는|이|가)?\s*없")

HEAD_CHARS = 200  # 두괄식 결론부 근사 — 첫 굵은 결론 문장이 이 안에 들어온다(실측 표본 기준)

# ── 시스템 노트 서명 레지스트리(specs/16 W1-C) — 이 모듈이 정본이다(rag_core를 임포트하지
#    않아 순환 없음). rag_core의 모든 사후 노트는 아래 접두로 시작해야 하며, 그 계약은
#    tools/test_refusal_detect.py가 rag_core 소스를 스캔해 강제한다.
# 왜: 노트는 \n\n 뒤에 붙는데, 첫 문단이 40자 미만이면 _head가 t[:200] 폴백으로 노트까지
#    스캔했다. numeric_guard_note의 "확인되지 않았습니다"가 REFUSAL_RE(확인되지\s*않)와
#    매치 → **정상 답변이 거부로 오채점**(2026-08-10 실측, T9와 같은 계열).
# ⛔ 제거는 **꼬리에서만** 한다 — 모델이 서두에 자체적으로 ⚠️를 쓰면 그건 결론일 수 있다.
#    판별은 정확한 제목 접두(NOTE_TITLES)로만 — 넓은 마커(⚠️ 전부)는 진짜 거부를 삼킨다.
NOTE_MARKERS = ("⚠️ **", "ℹ️ ")            # 신설 노트가 따라야 할 접두 규약(계약 검사용)
NOTE_TITLES = ("⚠️ **수치 확인 필요**",      # rag_core.numeric_guard_note
               "⚠️ **시스템 확인**",         # rag_core.system_attribution_note
               "ℹ️ 위 개수", "ℹ️ 질문하신 명칭", "⚠️ **근거 밖 주제**",                 # rag_core._ENUM_NOTE
               "최종 판단은")                # rag_core.DISCLAIMER(면책)
def _strip_trailing_notes(t: str) -> str:
    """꼬리의 시스템 노트·면책 문단 제거 — 거부 판정은 모델 본문만 봐야 한다."""
    paras = t.split("\n\n")
    while paras and paras[-1].lstrip().startswith(NOTE_TITLES):
        paras.pop()
    return "\n\n".join(paras)


def _head(text: str, head_chars: int = HEAD_CHARS) -> str:
    """결론부 추출 — 첫 빈 줄(문단 경계)까지, 없으면 head_chars.
    SYSTEM 두괄식 규약상 결론은 첫 문단(굵은 첫 줄)에 온다."""
    t = _strip_trailing_notes((text or "").strip())
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
