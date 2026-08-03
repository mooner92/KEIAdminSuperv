#!/usr/bin/env python3
"""test_gen_filter.py — 출제 결함 사전 회귀 (gen_filter.question_defects).

⛔ 픽스처 원칙: '나쁜 질문'은 전부 **2026-07-31 저녁 크론 실측 표본에서 발췌**한 실물이다.
   합성 예제로 통과시키면 실제 결함이 새는 걸 못 잡는다(그날 출제결함 7건이 그 증거).
LLM·네트워크·파일 I/O 없음 — 순수 함수만.
실행: cd eval && ../tools/.venv/bin/python test_gen_filter.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gen_filter import (PARA_MAX_OVERLAP, content_words, doc_overlap,  # noqa: E402
                        paraphrase, question_defects)


def test_real_defects_rejected():
    """실측 결함 문항 — 하나라도 통과하면 그날 사고가 재발한다."""
    bad = [
        # (질문, 기대 결함 코드가 하나 이상)
        ("게시물 등록 시 검수 완료 상태가 되면 어떤 값으로 표시되나요?", "문서파편"),
        ("발행 결정을 위한 참고 항목 중 '심사의견'은 어떤 필드에 저장되나요?", "문서파편"),
        ("전자결재/기안 레이어는 어떤 상황에서 호출되는가?", "문서파편"),
        ("「복무규정」 제18조에 따르면 을 병가 종료일로부터 얼마 이내에 해야 하나요?", "문장파손"),
        ("서식관리규정의 제1조는 언제부터 시행되나요?", "메타질문"),
        ("보관책임자가 비밀용기의 열쇠를 어떻게 관리해야 하는가?", "시험지말투"),
        ("홈페이지 개인정보 노출 시 주민등록번호 노출 현황에 포함되어야 하는 항목이 무엇인가?", "시험지말투"),
        ("상품권 및 기념품 지급이 제한되는 명절 등에서의 행위가 무엇인가?", "시험지말투"),
        ("인터넷 자료를 인용하는 경우에는 해당 URL 과 무엇을 표기하여야 하는가?", "시험지말투"),
        ("차량 정수 및 보유 현황 표에서 증감표시는 어떤 기준으로 작성되며 증감 사유는 어떻게 처리해야 하는가?", "문서파편"),
        ("전세금보장 신용보험이란 무엇인가?", "시험지말투"),
        ("학생이 개인컴퓨터에 설정해야 하는 보안 수칙 중 하나는 무엇인가?", "시험지말투"),
    ]
    for q, expect in bad:
        d = question_defects(q)
        assert d, f"⛔ 통과해버림(기대 {expect}): {q[:50]}"
        assert expect in d, f"코드 불일치(기대 {expect}, 실제 {d}): {q[:50]}"


def test_hanja_codeswitch_rejected():
    """한자 혼입 = 생성 모델의 코드 스위칭(2026-08-03 실측 12/661 · 일상어 4.2%).
    ⛔ 단 규정 병기 인용은 살려야 한다 — 괄호 안 한자까지 죽이면 정상 문항이 사라진다."""
    for q in ["올해 끝나면 예산决算 같은 거 만들어서 연구회에 내려는데 서류 뭐가 있어요?",
              "계급이나職位 같은 거로 나누어서 계산할까요?",
              "인턴 기간이 끝나면 제가 해볼 수 있는 일은 뭐都有哪些까요?"]:
        assert "한자혼입" in question_defects(q), q
    # 실측 정상 문항 — 한글(漢字) 병기는 규정 원문의 관행이다
    assert "한자혼입" not in question_defects("결과보고서에 심의가 부(否)라면 재제출 기준은 어떻게 되나요?")


def test_composite_chain_rejected():
    """단문 유형에서 '~이며/~되며' 연쇄 = 출제 냄새(복합형에서는 허용)."""
    q = ("원외겸직 신고 대상 유형별 관리 기준이 어떻게 되며, 승인 절차는 어떻게 되며, "
         "변경 시 무엇을 제출해야 하나요?")
    assert "복합절과다" in question_defects(q, qtype="절차형")
    assert "복합절과다" not in question_defects(q, qtype="복합형")


def test_parroting_rejected():
    """질문이 골든을 그대로 되읽으면(동어반복) 검색 없이도 맞는 무의미 문항."""
    g = "출장자는 출장 종료 후 15일 이내에 출장복명서를 제출하여야 한다."
    q = "출장자는 출장 종료 후 출장복명서를 제출하여야 하나요?"
    assert "동어반복" in question_defects(q, g)


def test_good_questions_pass():
    """⛔ 오탐이 나면 좋은 문항까지 죽는다 — 실측 정상 문항·사람다운 문형은 통과해야 한다."""
    ok = [
        "출장 다녀왔는데 복명서 언제까지 내야 하나요?",
        "제가 결혼하게 되면 축의금은 어떤 기준으로 받게 되나요?",
        "다음 주에 국내출장 가는데 여비는 어떻게 계산되나요?",
        "연차휴가는 어떻게 신청하나요?",
        "법인카드로 경조사비를 결제해도 되나요?",
        "5,083만원짜리 공사･수리는 누구 전결로 처리하나요?",   # 실측 정상(전결 매트릭스)
        "규정상 '전자이미지서명'의 정의를 알려주세요.",          # defterm 축 — 주세요. 종결 허용
        "명상실은 어떻게 예약하나요?",                            # 거부형 실측 정상
        "공동 참여 저자인 경우 지원되는 비용은 어떻게 계산하나요?",
    ]
    for q in ok:
        d = question_defects(q)
        assert not d, f"오탐 {d}: {q}"


def test_ending_rules():
    """종결어미 — 해요체만. 명사 종결·평서문은 챗봇에 치는 말이 아니다."""
    assert "종결어미" in question_defects("국내출장 여비 지급 기준.")
    assert "종결어미" in question_defects("연차휴가 신청 절차를 정리한 평서문이다")
    assert not question_defects("연차휴가 며칠까지 쓸 수 있나요?")
    assert not question_defects("초과근무 수당 신청 방법 좀 알려주세요.")


# ───────── 일상어 패러프레이즈(specs/11 A1) ─────────
# ⛔ 픽스처 주의: 질문은 실측이지만 **원문 문자열은 전부 합성**이다 — 이 레포는 코드 전용이라
#    규정 원문을 테스트에 박으면 데이터 분리 원칙이 깨진다. doc_overlap은 순수 어휘 함수라
#    합성 원문으로도 계약이 그대로 검증된다.
_SRC = "출장자는 출장 종료 후 15일 이내에 출장복명서를 제출하여야 한다. 여비는 별표에 따라 지급한다."


def test_overlap_separates_vocabulary_layers():
    """문서어 질문은 높고, 일상어로 바꾼 질문은 낮아야 한다 — 이 분리가 어휘 갭 측정의 전제."""
    doc_q = "출장복명서는 출장 종료 후 며칠 이내에 제출하여야 하나요?"
    plain_q = "출장 다녀오면 보고서 같은 거 언제까지 내야 하나요?"   # 실측 패러프레이즈 산출물
    assert doc_overlap(doc_q, _SRC) >= 0.8, doc_overlap(doc_q, _SRC)
    assert doc_overlap(plain_q, _SRC) <= PARA_MAX_OVERLAP, doc_overlap(plain_q, _SRC)


def test_interrogative_tokens_excluded():
    """지표 자체의 결함 회귀(2026-08-02 실측): '무엇입니까'가 분모를 채워 겹침이 0.00으로 나왔다.
    의문·서술 토큰은 내용어가 아니다 — 아니면 임계값이 통째로 거짓이 된다."""
    src = "중복게재란 이미 발표한 논문을 다시 게재하는 것을 말한다."
    q = "중복게재란 무엇입니까?"
    assert doc_overlap(q, src) == 1.0, doc_overlap(q, src)
    # 남는 내용어는 주제어 하나뿐이어야 한다(의문형이 분모를 채우면 이 수가 늘고 겹침이 무너진다)
    assert content_words(q) == {"중복게재란"}, content_words(q)


def _fake_llm(para: str, equal: bool = True):
    """패러프레이저/심판 두 역할을 프롬프트로 구분하는 가짜 LLM."""
    def fn(messages, **kw):
        sysmsg = messages[0]["content"]
        return {"같음": equal, "사유": "테스트"} if "같은 것을 묻고 있는지" in sysmsg else {"질문": para}
    return fn


def test_paraphrase_rejects_residual_document_vocabulary():
    """문서 용어가 그대로 남은 '패러프레이즈'는 실패다 — 통과시키면 일상어 정답률이 거짓이 된다."""
    p, why = paraphrase(_fake_llm("출장복명서는 출장 종료 후 언제까지 제출하여야 하나요?"),
                        "원 질문", _SRC, tries=1)
    assert p is None and "어휘겹침" in why, (p, why)


def test_paraphrase_rejects_meaning_drift():
    """뜻이 흐르면 폐기 — 실측 5/16이 여기서 걸렸다(승인 절차→제출 기한, 조정→신규 등록).
    이걸 통과시키면 서비스가 멀쩡해도 오답이 찍혀 어휘 갭을 측정이 스스로 오염시킨다."""
    p, why = paraphrase(_fake_llm("휴가 신청은 어디서 하나요?", equal=False), "원 질문", _SRC, tries=1)
    assert p is None and "뜻 달라짐" in why, (p, why)


def test_paraphrase_accepts_plain_language():
    p, why = paraphrase(_fake_llm("출장 다녀오면 보고서 같은 거 언제까지 내야 하나요?"),
                        "원 질문", _SRC, tries=1)
    assert p and "겹침" in why, (p, why)


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
    sys.exit(1 if bad else print(f"\n✅ {len(fns)}개 통과 — 출제 결함 사전(실측 픽스처)") or 0)
