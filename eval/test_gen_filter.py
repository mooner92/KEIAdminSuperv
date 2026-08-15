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
                        golden_defects, paraphrase, question_defects)
from daily_common import chunk_unanswerable  # noqa: E402  출제 후보 청크 게이트(순수 함수)


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


# ───────── 출제 지시문 누출(2026-08-15 실측) ─────────
def test_prompt_leak_rejected():
    """출제 LLM이 **자기가 받은 지시를 그대로 뱉은** 문항 — 은행 전수에서 실제로 발견됐다.
    이 문장은 '요'로 끝나 종결어미 게이트를 통과했고 지시어·한자·파편도 없어 전부 빠져나갔다.
    시험 문제 자리에 출제 지시문이 앉으면 서비스가 무엇을 하든 오답이다(순수한 점수 오염)."""
    real = "탕비실 커피머리 보습을 위한 자연스러운 질문 1개 만들어주세요."
    assert "출제지시누출" in question_defects(real), question_defects(real)
    for q in ["다음 주제로 질문을 만들어 JSON으로 출력하세요.",
              "주제: 출장비 정산에 대해 자연스러운 문항 1개 생성해주세요.",
              '{"질문": "연차 신청은 어떻게 하나요?"} 형식으로 출력하라']:
        assert "출제지시누출" in question_defects(q), q


def test_prompt_leak_spares_polite_requests():
    """⛔ 오탐 방지선 — 은행의 정상 문항 132건이 '알려주세요'로 끝난다.
    '만들어/생성해 주세요'만 물고 '알려/설명해 주세요'는 건드리면 안 된다."""
    for q in ["초과근무 수당 신청 방법 좀 알려주세요.",
              "규정상 '전자이미지서명'의 정의를 알려주세요.",
              "출장 여비 계산 기준을 설명해주세요."]:
        assert "출제지시누출" not in question_defects(q), q


# ───────── 기대 정답(골든) 결함 사전 ─────────
# ⛔ 픽스처 주의: 골든은 원래 볼트 verbatim이라 여기서는 **구조만 같은 합성 문자열**을 쓴다
#    (이 레포는 코드 전용 — 위 _SRC 주석과 같은 원칙). golden_defects는 순수 형태 함수라
#    합성 픽스처로도 계약이 그대로 검증된다.
def test_golden_label_rejected():
    """골든이 '답이 담긴 한 문장'이 아니면 무슨 답을 해도 대조가 안 된다.
    실측 계기: 질문 '퇴직하면 정산 절차가 어떻게 되나요?' / 골든 '#### (공통)…행사'."""
    for g, code in [("#### (공통)국내외교류협력및행사", "제목줄"),
                    ("## 제3절 보존기간", "제목줄"),
                    ("(담당)대정부자료수발관리", "괄호라벨"),
                    ("화면에 확인되는 컬럼:", "콜론종결"),
                    ("- 성명 : - 생년월일 :", "콜론종결"),
                    ("| 기능정리 2 | 기능정리_2_GEN.md | 일반·총무 |", "파일명")]:
        assert code in golden_defects(g), (g, golden_defects(g))
    assert golden_defects("") == ["골든없음"]


def test_golden_keeps_table_rows():
    """⛔ **표 행 골든은 일부러 살린다** — 측정이 직관을 기각했다(2026-08-15).
    파이프표 골든 159건의 미정답률은 14%로 기저(15%)와 같았고 136건이 정답이었다.
    여기서 표를 막으면 정상 문항을 대량으로 죽인다."""
    for g in ["| 200만원 이하 | 전결권자 실･팀장 |",
              "| 구분 | 지급액 | 비고 |  200만원 |",
              "출장자는 출장 종료 후 15일 이내에 출장복명서를 제출하여야 한다."]:
        assert not golden_defects(g), (g, golden_defects(g))


# ───────── 출제 후보 청크 게이트 ─────────
# ⛔ 픽스처는 **구조만** 재현한 합성 문서다(데이터 분리 원칙). 게이트는 줄 길이·비율만 보는
#    순수 함수라 형태가 같으면 계약이 검증된다.
def test_chunk_gate_rejects_conversion_debris():
    """세로쓰기 PDF 잔해·목차 쪽번호는 '문답 가능한 지식'이 아니다(실측 미정답률 22.6%)."""
    vertical = "\n".join(list("출판물발간절차부록") + ["2024", "99", "01"])
    assert "문자파편" in chunk_unanswerable(vertical), chunk_unanswerable(vertical)
    columns = "* 컬럼:\n" + "\n".join(f"  * {n}" for n in
                                      ["No", "선택", "상태", "성명", "소속", "직위", "역할"])
    assert "라벨나열" in chunk_unanswerable(columns), chunk_unanswerable(columns)
    build = "\n".join(["| 원본 | 파일명 | 모듈 |",
                       "| 기능정리 1 | 기능정리1.md | 회계 |",
                       "| 기능정리 2 | 기능정리2.md | 총무 |"])
    assert "적재산출물" in chunk_unanswerable(build), chunk_unanswerable(build)
    assert chunk_unanswerable("") == ["빈청크"]


def test_chunk_gate_spares_normal_prose_and_gaejosik():
    """⛔ 이 코퍼스는 **개조식이 정상**이다(가이드·시스템 문서).
    '서술어로 끝나야 한다'는 과거 철회된 게이트 — 표·라벨 밀도로도 개조식을 죽이면 안 된다.
    실측 제외율: regulation 0.1% · term 0%(규정 원문은 사실상 무손실)."""
    gaejosik = ("- 미준수시 1일 3점씩 감점\n"
                "- 연 15일의 유급휴가 부여\n"
                "- 초과근무는 사전 승인 후 인정\n"
                "- 부서장 전결로 처리한다")
    assert not chunk_unanswerable(gaejosik), chunk_unanswerable(gaejosik)
    table_with_prose = ("| 구분 | 지급액 |\n| --- | --- |\n| 국내출장 | 20,000원 |\n"
                        "출장자는 출장 종료 후 15일 이내에 출장복명서를 제출하여야 한다.\n"
                        "여비는 별표 2의 기준에 따라 지급하며 부서장이 승인한다.")
    assert not chunk_unanswerable(table_with_prose), chunk_unanswerable(table_with_prose)


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
