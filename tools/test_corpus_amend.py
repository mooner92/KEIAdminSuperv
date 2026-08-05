#!/usr/bin/env python3
"""test_corpus_amend.py — 개정안 판별·해독 회귀 (specs/14 G).

⛔ 픽스처는 전부 합성이다(공개 레포 데이터 분리). 다만 **구조와 실패 양상은 실측**이다 —
   2026-08-04 「위임전결규정 개정(안)」에서 실제로 겪은 것을 합성 규정으로 옮겼다.

못박는 계약:
  ① 대비표를 **전문으로 착각하면 안 된다** — 착각하면 651줄 규정이 51줄 요약본으로 덮인다
  ② 중첩 표(<td> 안에 <table>)를 **깊이로 세야** 행이 나온다
     (실측 결함: 바깥 <table> 태그가 깊이를 1 올려 **대비표 0행**이 나왔다)
  ③ "생략"은 **포함 판정**이어야 한다 — 셀이 붙어 "8. 대외활동 생략"이 되면 단독 매치가 빗나가고
     가장 위험한 경고(본문이 이 문서에 없다)가 조용히 사라진다(실측)
  ④ 가운뎃점 이형(·/･/‧)만 다른 줄을 **못 찾음으로 떨구면 안 된다**
  ⑤ 전문 개정본은 지금처럼 교체가 **통과**해야 한다(관문이 정상 경로를 막으면 안 된다)
  ⑥ **실제 업로드 경로는 kordoc이 아니라 01c(hwp-hwpx-parser)를 쓴다** — 표를 HTML이 아니라
     마크다운 파이프로 낸다. 2026-08-05 실측: HTML만 지원해서 실제 파일이 대비표 0행으로
     파싱되고, 표 전체가 개정이유 목록에 원문 그대로 흘러들었다(운영자가 화면에서 직접 목격)
실행: python tools/test_corpus_amend.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import corpus_amend as CA  # noqa: E402

# 실제 개정안의 구조를 그대로 옮긴 합성본 — 중첩 표·생략·좌동·부칙 신설이 전부 들어 있다.
AMEND = """합성규정 개정(안)

(합성부서, 2026.7.15.)

□ 개정이유

ㅇ 「합성직제규정」 개정(안)을 반영하여 「합성규정」을 개정

- 합성단 신설에 따른 조정

붙임1 합성규정 개정(안) 신‧구조문 대비표

<table>
<tr><th>현행</th><th>개정(안)</th><th>비고</th></tr>
<tr><td>(별표)<br>합성사항<br><공통><br><table>
<tr><th>구 분</th><th>직무내용</th></tr>
<tr><td>1. 가~<br>8. 하</td><td>생략</td></tr>
</table></td><td>(별표)<br>합성사항<br><공통><br>- 좌동 -</td><td>표 유지</td></tr>
<tr><td>4. 실･팀장은 합성부서의 실장, 합성센터의 실장, 기획･행정부서의 팀장임<br>5. 합성센터장의 위임은 실장 체계를 준용함</td><td>4. 실장은 합성부서, 합성센터, 기획･행정부서의 실장임<br>5. 합성센터장의 위임은 실장 체계를 준용함<br>6. 합성단장의 위임은 실장 체계를 준용함</td><td>직책 현행화</td></tr>
<tr><td></td><td>부 칙&lt;2026. 7. 27.&gt;<br>제1조(시행일) 이 규정은 2026년 8월 3일부터 시행한다.</td><td></td></tr>
</table>
"""

# 볼트 문서 쪽은 가운뎃점이 '·'다(대비표는 '･') — ④ 이형 흡수를 여기서 시험한다.
DOC = """---
type: regulation
규정번호: "1999"
규정명: "합성규정"
---

# 합성규정

제1조(목적) 합성 테스트를 목적으로 한다.

4. 실·팀장은 합성부서의 실장, 합성센터의 실장, 기획·행정부서의 팀장임

5. 합성센터장의 위임은 실장 체계를 준용함

<기획･행정>

<table>
<tr><td>과제<br>책임자(담당)</td><td>팀장</td><td>부서장</td><td>부원장</td></tr>
</table>
"""

FULL = """---
type: regulation
규정명: "합성규정"
---

# 합성규정

제1조(목적) 합성 테스트를 목적으로 한다.
제2조(정의) 합성이란 시험용을 말한다.
제3조(적용) 이 규정을 적용한다.
제4조(예외) 예외를 둔다.
제5조(위임) 세부는 따로 정한다.
제6조(기타) 기타 사항.
"""


def test_amendment_is_not_mistaken_for_full_text():
    """① 대비표를 전문으로 착각하지 않는다 — 착각하면 규정 본문이 사라진다."""
    c = CA.classify(AMEND)
    assert c["kind"] == CA.KIND_AMEND, c
    assert c["조문수"] == 0, c
    ok, why = CA.replaceable(AMEND)
    assert not ok and "대비표" in why, why


def test_full_text_still_passes_the_gate():
    """⑤ 관문이 정상 경로(전문 개정본)를 막으면 기능이 죽는다."""
    assert CA.classify(FULL)["kind"] == CA.KIND_FULL
    ok, _ = CA.replaceable(FULL)
    assert ok, "전문 개정본은 교체 가능해야 한다"


def test_short_regulation_is_not_blocked():
    """⑤' 짧은 규칙·지침(조문 2개)도 교체돼야 한다.

    실측 결함(2026-08-04): ARTICLE이 **너비 0 lookahead**인데 set()으로 감싸 조문 수가 항상
    1로 붕괴했고, 임계값을 5로 두는 바람에 6조짜리 전문까지 '불명'으로 막혔다. 안전 관문이
    정상 업무를 막으면 사람은 관문을 꺼버린다 — 그게 진짜 사고다."""
    small = "제1조(목적) 목적이다.\n\n제2조(적용) 적용한다.\n"
    c = CA.classify(small)
    assert c["조문수"] == 2, c
    assert c["kind"] == CA.KIND_FULL, c
    assert CA.replaceable(small)[0], "짧은 규정을 막으면 안 된다"


def test_nested_tables_still_yield_rows():
    """② 중첩 표를 깊이로 세지 않으면 대비표가 0행이 된다(실측 결함)."""
    p = CA.parse(AMEND)
    assert len(p["행"]) == 3, [r["종류"] for r in p["행"]]
    assert p["시행일"] == "2026-08-03", p["시행일"]
    assert any("합성단 신설" in r for r in p["개정이유"]), p["개정이유"]


def test_omitted_marker_warns_even_when_glued_to_text():
    """③ '생략'이 앞 셀과 붙어도 경고가 떠야 한다 — 본문 소실을 막는 마지막 방어선."""
    row = CA.parse(AMEND)["행"][0]
    assert any("생략" in w for w in row["경고"]), row["경고"]
    assert any("좌동" in w for w in row["경고"]), row["경고"]
    assert row["표"] is True, "별표 내용임을 표시해야 '미발견'을 결함으로 오해하지 않는다"


def test_changed_line_is_located_in_vault_despite_middot_variants():
    """④ ·/･ 차이로 '못 찾음'이 되면 사람이 어디를 고칠지 알 수 없다."""
    props = CA.propose(DOC, CA.parse(AMEND))
    row = props[1]
    pair = next((x for x in row["변경"] if x["현행줄"] and x["개정줄"]), None)
    assert pair, row["변경"]
    assert pair["볼트줄"] == 11, pair          # DOC 11줄 = '4. 실·팀장은 …'
    assert pair["상태"] == "확정", pair
    assert "실장은 합성부서" in pair["개정줄"], pair
    assert any(x["상태"] == "신설" and "6." in x["개정줄"] for x in row["변경"]), row["변경"]


def test_angle_bracket_text_is_not_stripped_as_html():
    """⑥ 꺾쇠를 전부 태그로 보면 **규정 원문이 지워진다**(2026-08-04 실측).

    `부 칙<2026. 7. 27.>`의 시행 날짜와 `<공통>` 같은 구획 표시가 통째로 사라졌고,
    그 탓에 부칙 표제가 '부 칙'만 남아 문서에 누적된 옛 부칙과 같아 보였다
    (→ 신설 부칙이 '이미 반영됨'으로 오판돼 반영이 조용히 누락됐다)."""
    p = CA.parse(AMEND)
    buchik = p["행"][-1]["개정"]
    assert any("2026. 7. 27." in x for x in buchik), buchik
    flat = " ".join(x for r in p["행"] for x in r["현행"] + r["개정"])
    assert "<공통>" in flat, "구획 표시가 태그로 오인돼 사라졌다"


AMEND_PIPE = """합성규정 개정(안)

(합성부서, 2026.7.15.)

□ 개정이유

ㅇ 「합성직제규정」 개정(안)을 반영하여 「합성규정」을 개정

- 합성단 신설에 따른 조정

□ 주요내용

| 구분 | 조항 | 주요 제·개정 사항 | 비고 |
| --- | --- | --- | --- |
| 위임<br>전결 규정 | 별표 | <기획·행정> | 1.가~27.하 관련 직무 결재권자 명칭<br>(현행) 팀장 ▶ (변경) 실･팀장 | 편제 체계 지속성 유지 |

□ 붙임자료: 합성규정 개정(안) 신·구조문 대비표 1부. 끝.

붙임1 합성규정 개정(안) 신·구조문 대비표

| 현행 | 개정(안) | 비고 |
| --- | --- | --- |
| (별표)<br>합성사항<br><공통><br>구 분 직무내용 전결권자 원장 1. 가~<br>8. 하 생략 | (별표)<br>합성사항<br><공통><br>좌동 - | 표 유지 |
| 4. 실･팀장은 합성부서의 실장, 합성센터의 실장, 기획･행정부서의 팀장임<br>5. 합성센터장의 위임은 실장 체계를 준용함 | 4. 실장은 합성부서, 합성센터, 기획･행정부서의 실장임<br>5. 합성센터장의 위임은 실장 체계를 준용함<br>6. 합성단장의 위임은 실장 체계를 준용함 | 직책 현행화 |
|  | 부    칙<2026. 7. 27.><br>제1조(시행일) 이 규정은 2026년 8월 3일부터 시행한다. |  |
"""


def test_pipe_table_upload_path_is_parsed():
    """⑥ 실제 업로드(01c) 산출물인 **파이프 마크다운 표**도 HTML 표와 동일하게 파싱돼야 한다.

    실측 결함: HTML `<table>`만 인식해서 파이프 표는 대비표 0행이 됐고, 표 전체 원문이
    '개정이유' 목록에 그대로 흘러들어 화면에 노출됐다(사용자가 실제 화면에서 목격).
    """
    c = CA.classify(AMEND_PIPE)
    assert c["kind"] == CA.KIND_AMEND, c
    assert "현행/개정(안) 대조표 머리(파이프)" in c["강신호"], c["강신호"]

    p = CA.parse(AMEND_PIPE)
    assert p["개정이유"] == ["「합성직제규정」 개정(안)을 반영하여 「합성규정」을 개정",
                            "합성단 신설에 따른 조정"], p["개정이유"]
    assert len(p["행"]) == 3, [r["종류"] for r in p["행"]]          # 표 전체가 새지 않았다
    tbl_row = p["행"][0]
    assert tbl_row["표"] is True, tbl_row                            # 전결권자 어휘로 짚었다
    assert any("생략" in w for w in tbl_row["경고"]), tbl_row["경고"]

    props = CA.propose(DOC, p)
    ok = [x for r in props for x in r["변경"] if x["반영가능"]]
    assert len(ok) == 4, ok                    # replace·insert·부칙·별표 헤더(cell) 각 1
    assert not any(x["반영가능"] for x in props[0]["변경"]), "표 행이 열려 있다"


def test_summary_table_cell_change_is_extracted_and_matched():
    """운영자 지적(2026-08-05): '표는 사람이 확인'을 무조건 적용하면 자동화 취지에 어긋난다.
    요약표("(현행) X ▶ (변경) Y")는 대비표 본문(생략)과 달리 **명확한 지시**다 — 실제 볼트에서
    대상 셀(`<td>팀장</td>`)이 정확히 한 곳뿐임을 확인하고 이 경로를 열었다."""
    p = CA.parse(AMEND_PIPE)
    assert p["요약변경"] == [{"구획": "기획·행정", "현행": "팀장", "개정": "실･팀장"}], p["요약변경"]

    props = CA.propose(DOC, p)
    cell_row = next(r for r in props if r["종류"] == "별표 헤더 변경")
    it = cell_row["변경"][0]
    assert it["모드"] == "cell" and it["상태"] == "확정" and it["반영가능"], it
    assert it["볼트줄"] == 18, it                                  # DOC의 <td>팀장</td> 줄
    assert it["현행줄"] == "팀장" and it["개정줄"] == "실･팀장", it


def test_summary_cell_change_locks_when_ambiguous_in_vault():
    """대상 셀이 볼트에 **여러 곳**이면(또는 없으면) 여전히 잠긴다 — 요약표 발견이
    안전장치를 우회하지 않는다."""
    dup_doc = DOC + "\n<table>\n<tr><td>팀장</td></tr>\n</table>\n"
    p = CA.parse(AMEND_PIPE)
    props = CA.propose(dup_doc, p)
    cell_row = next(r for r in props if r["종류"] == "별표 헤더 변경")
    it = cell_row["변경"][0]
    assert it["상태"] == "모호" and not it["반영가능"], it
    assert "여러 곳" in it["불가사유"], it["불가사유"]


def test_title_reads_pipe_boxed_text_not_raw_syntax():
    """01c는 표제도 '|  |\\n| --- |\\n| 제목 |' 파이프 박스로 낸다 — 첫 줄을 그대로 집으면
    '|  |'(빈 칸)가 뽑힌다(2026-08-05 실측, 화면 상단에 그대로 노출됐다)."""
    boxed = "|  |\n| --- |\n| 합성규정 개정(안) |\n|  |\n\n" + AMEND_PIPE
    assert CA.parse(boxed)["제목"] == "합성규정 개정(안)"


def test_target_regulation_extracted_and_survives_filename_suffixes():
    """대상규정 추출이 **파일명보다 안정적**이어야 한다.

    실측 결함(2026-08-05): 파일명에 배포 접미사("(1)", 날짜 "260721")가 붙자 문자열 유사도가
    0.6 임계값 밑으로 떨어져 "대상 문서를 찾지 못했습니다"가 떴다. 문서가 스스로
    "「합성규정」을 개정"이라 말하는 문장에서 규정명을 뽑으면 접미사와 무관하게 항상 정확하다."""
    p = CA.parse(AMEND_PIPE)
    assert p["대상규정"] == "합성규정", p["대상규정"]     # 「합성직제규정」이 아니라 뒤쪽 것

    fragile_name = "(ver3)합성규정_개정(안)_-_조직개편 (1)_260721.hwpx"
    import difflib
    from corpus_replace import _norm_title
    ratio = difflib.SequenceMatcher(None, _norm_title(fragile_name), "합성규정").ratio()
    assert ratio < 0.6, f"픽스처가 실패 재현을 못 함(ratio={ratio:.2f}) — 접미사를 늘릴 것"


def test_no_write_path_exists():
    """⛔ 이 모듈은 볼트를 쓰지 않는다 — 자동 반영이 생기는 순간 규정을 지어내게 된다."""
    src = Path(CA.__file__).read_text(encoding="utf-8")
    for bad in ("write_text(", "shutil.copy", "os.replace"):
        assert bad not in src, f"쓰기 경로가 생겼다: {bad}"


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
    sys.exit(1 if bad else print(f"\n✅ {len(fns)}개 통과 — 개정안 판별·해독") or 0)
