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
from gen_filter import question_defects  # noqa: E402


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
