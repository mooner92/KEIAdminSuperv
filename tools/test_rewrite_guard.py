#!/usr/bin/env python3
"""test_rewrite_guard.py — P1.5 멀티턴 재작성 위생 가드 유닛.

실측 결함(dev session 42): 재작성 LLM이 직전 '답변'을 복사해 검색어로 출력
→ 질문 단어 미도달 + 직전 오답이 검색어에 주입(자기강화) → "존재하지 않습니다" 거짓 부정.
가드(_rewrite_ok)가 그 출력을 거르고, 정상 재작성·지시대명사 후속질문은 통과해야 한다.
적대적 리뷰(3렌즈) 재현 케이스 포함: 구어 후속질문 과차단, 규정명 재사용 오인, 조사 과제거,
전각/대소문자/NFD 정규화 우회.

실행: .venv/bin/python tools/test_rewrite_guard.py  (모델 미로딩 — 순수 로직)
"""
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rag_core import _rewrite_ok, _rw_core_tokens, _rw_norm  # noqa: E402

# session 42 실제 이력(축약) — 마지막 assistant 답변이 복사 원본
HIST = [
    {"role": "user", "content": "모든 위원회 목록을 뽑아줘"},
    {"role": "assistant", "content": "**규정상 '위원회'라는 명칭의 구체적 목록은 제시되지 않으며, 운영 대상에 따라 "
     "'기후변화영향평가 검토 위원회'와 '환경영향평가 검토 위원회' 두 가지 유형이 존재합니다.**"},
    {"role": "user", "content": "서류평가 위원회가 뭐야?"},
    {"role": "assistant", "content": "**규정상 '서류평가 위원회'라는 명칭의 조직은 존재하지 않으며, 관련 업무는 "
     "'환경평가검토전문위원회'와 '평가서 주간검토회의'에서 수행됩니다.**  1. **환경평가검토전문위원회**: ..."},
]
Q = "인사 위원회, 징계 위원회에 대해 알려줘"


# ── 복사(에코) 차단 ────────────────────────────────────────────────
def test_session42_echo_rejected():
    """실제 결함 재현값: 직전 답변 복사(마크다운·따옴표만 다름) → 거부."""
    echo = ("규정상 '서류평가 위원회'라는 명칭의 조직은 존재하지 않으며, 관련 업무는 "
            "'환경평가검토전문위원회'와 '평가서 주간검토회의'에서 수행됩니다.")
    assert not _rewrite_ok(echo, Q, HIST)


def test_truncated_echo_rejected():
    """max_tokens 절단으로 앞부분만 복사돼도 거부(서술 종결 '~않으며' 신호)."""
    assert not _rewrite_ok("규정상 '서류평가 위원회'라는 명칭의 조직은 존재하지 않으며", Q, HIST)


def test_nfd_echo_still_rejected():
    """이력이 NFD(자모분해)여도 NFC 정규화로 복사 감지(HWP 변환 잔재 대비)."""
    hist_nfd = [{"role": "assistant", "content": unicodedata.normalize("NFD", HIST[3]["content"])}]
    echo = "규정상 '서류평가 위원회'라는 명칭의 조직은 존재하지 않으며, 관련 업무는 '환경평가검토전문위원회'와 '평가서 주간검토회의'에서 수행됩니다."
    assert not _rewrite_ok(echo, Q, hist_nfd)


def test_long_output_rejected():
    """200자 초과 장문(설명문·답변체) → 거부."""
    assert not _rewrite_ok("가" * 201, Q, HIST)


# ── 정당한 재작성 통과(과차단 방지 — 리뷰 재현 케이스) ─────────────────
def test_good_rewrite_passes():
    assert _rewrite_ok("KEI 인사위원회와 징계위원회의 구성·역할", Q, HIST)


def test_identity_rewrite_passes():
    assert _rewrite_ok(Q, Q, HIST)


def test_same_as_prior_user_question_passes():
    """이전 '사용자' 질문과 동일한 재작성은 정상(재질문 복원) — assistant 복사만 차단."""
    assert _rewrite_ok("서류평가 위원회가 뭐야?", "그거 다시 알려줘", HIST)


def test_answer_prefix_nounphrase_passes():
    """답변 첫 줄(두괄식 규칙2)의 접두 명사구를 재사용한 이상적 재작성 → 통과(리뷰: 과차단 major)."""
    hist = [{"role": "assistant", "content": "**국내출장 출장복명서 ERP 작성·제출 방법은 다음과 같습니다.** 1. ..."}]
    assert _rewrite_ok("국내출장 출장복명서 ERP 작성·제출 방법", "그거 ERP에서 어떻게 해?", hist)


def test_regname_reuse_passes():
    """답변에 인용된 긴 규정명(절대규칙3)을 그대로 쓴 재작성 → 통과(리뷰: 과차단 major)."""
    hist = [{"role": "assistant", "content": "관련 기준은 「한국환경연구원 임직원 행동강령 시행세칙」 제9조에 규정되어 있습니다."}]
    assert _rewrite_ok("한국환경연구원 임직원 행동강령 시행세칙 제9조", "그 조문 내용 알려줘", hist)


def test_colloquial_followups_pass():
    """구어 후속질문(의문사·활용형 토큰뿐) → 핵심어 검사 미적용으로 통과(리뷰: _RW_STOP 갭 major)."""
    cases = [
        ("국외출장 숙박비 상한액 기준", "그거 얼마 정도 드나요?"),
        ("육아휴직 신청 승인 처리 기간", "얼마 정도 걸리나요?"),
        ("경조사 휴가 승인 소요 기간", "그거 얼마나 걸려?"),
        ("ERP 출장신청 전자결재 상신 방법", "거기서 바로 되나요?"),
        ("출장 이동일 여비 지급 여부", "그날도 쳐주나요?"),
        ("경조사비 지급 기준 금액", "경조금 얼마 받아?"),
        ("직원 보수 지급일", "월급날 언제야?"),
        ("부서 간담회비 사용 한도", "회식비 얼마까지 돼?"),
        ("출산전후휴가 부여 일수", "애 낳으면 휴가 며칠 받아?"),
    ]
    for rq, q in cases:
        assert _rewrite_ok(rq, q, HIST), f"과차단: {q!r} -> {rq!r}"


def test_anaphora_followup_not_overblocked():
    assert _rewrite_ok("국내출장 여비 정산 기한", "그건 언제까지야?", HIST)
    assert _rewrite_ok("연차휴가 이월 가능 여부", "그럼 이월은?", HIST)


def test_casefold_english_tokens():
    """영문 대소문자 차이(ERP↔erp)로 핵심어 불일치가 나지 않아야 함(리뷰 minor)."""
    assert _rewrite_ok("erp 계정 신청 방법", "ERP 아이디 발급 어떻게 해?", HIST)


def test_nfd_rewrite_passes():
    """재작성이 NFD여도 NFC 질문 핵심어와 매칭(리뷰 minor)."""
    rq = unicodedata.normalize("NFD", "인사위원회 징계위원회 구성과 기능")
    assert _rewrite_ok(rq, Q, HIST)


# ── 드리프트 차단 유지 ─────────────────────────────────────────────
def test_unrelated_drift_rejected():
    """질문 핵심어(≥2)가 하나도 안 남은 무관 출력 → 거부."""
    assert not _rewrite_ok("환경영향평가 검토 절차와 주간검토회의 운영", Q, HIST)


def test_drift_with_short_nouns_rejected():
    """'휴가·제도' 같은 2자 명사도 조사 과제거로 파괴되지 않고 드리프트를 잡아야 함(리뷰: 조사 major)."""
    assert not _rewrite_ok("환경영향평가 검토 절차와 주간검토회의 운영", "휴가 제도 알려줘", [])


# ── 토크나이저·정규화 단위 ──────────────────────────────────────────
def test_core_tokens():
    toks = _rw_core_tokens(Q)
    assert {"인사", "위원회", "징계"} <= toks           # 조사 제거(위원회에→위원회)
    assert "대해" not in toks and "알려줘" not in toks  # 기능어 제외


def test_core_tokens_keep_short_nouns():
    """끝 글자가 조사와 겹치는 2자 명사(휴가·회의·제도·심의·보수) 보존(리뷰: 조사 major)."""
    toks = _rw_core_tokens("휴가 제도 회의 심의 보수 수당")
    assert {"휴가", "제도", "회의", "심의", "보수", "수당"} <= toks


def test_core_tokens_drop_predicates():
    """활용형(드나요·걸리나요·되나요)·의문사(얼마·며칠)는 핵심어가 아님."""
    toks = _rw_core_tokens("그거 얼마 정도 드나요? 며칠 걸리나요?")
    assert toks == set(), f"잔여 토큰: {toks}"


def test_norm_ignores_markdown():
    assert _rw_norm("**규정상 '서류평가 위원회'**") == _rw_norm("규정상 서류평가 위원회")


def test_norm_fullwidth_and_case():
    """전각 문자·대소문자 우회 차단(화이트리스트 정규화, 리뷰 major)."""
    assert _rw_norm("ＥＲＰ：계정＊신청") != ""  # 전각 영문은 casefold로 보존, 전각 기호는 제거
    assert _rw_norm("ERP 계정") == _rw_norm("erp　계정")  # 전각 공백 + 대소문자


# ── P2.10 집계 정직성 백스톱(_ensure_enum_note) ─────────────────────────
def test_enum_note_appended_when_missing():
    """개수·전수 질문 + 한정 문구 없는 답변 → 안내 결정적 부착."""
    from rag_core import _ensure_enum_note
    out = _ensure_enum_note("위원회 몇개있어?", "위원회는 5개입니다.")
    assert "전체" in out and "둘러보기" in out


def test_enum_note_not_duplicated():
    """모델이 이미 한정 표기를 했으면 중복 부착 없음."""
    from rag_core import _ensure_enum_note
    t = "검색된 근거에서는 5개가 확인됩니다(전체 목록 아님)."
    assert _ensure_enum_note("위원회 몇개있어?", t) == t


def test_enum_note_skipped_for_single_fact():
    """단건 질문(비집계)에는 부착하지 않음 — 두괄식 단답 유지."""
    from rag_core import _ensure_enum_note
    t = "경조사 휴가는 별표 1에 따라 사유별로 다릅니다."
    assert _ensure_enum_note("경조사 휴가는 며칠이야?", t) == t


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"  ok  {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  ❌  {fn.__name__}: {e}")
    if failed:
        sys.exit(1)
    print(f"\n✅ {len(fns)}개 테스트 통과 — P1.5 재작성 위생 가드")
