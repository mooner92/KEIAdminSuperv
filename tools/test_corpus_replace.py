#!/usr/bin/env python3
"""test_corpus_replace.py — 개정본 교체 엔진 회귀 (specs/14 T02).

⛔ 픽스처는 전부 합성이다(공개 레포 데이터 분리). 검증 대상은 판정 규칙이다.
못박는 계약:
  ① **부칙마다 제1조가 다시 시작**한다 — 라벨만 키로 쓰면 조문이 뭉개진다
     (실측: 위임전결규정 35조 중 27개가 중복 라벨이라 8건으로 붕괴했다)
  ② 부칙이 하나 늘어도 **직전 조문이 '변경'으로 오탐되면 안 된다**(꼬리 효과)
  ③ 같은 문서를 비교하면 변경 0 — 형식 잡음이 새면 사람이 진짜 변경을 못 본다
  ④ 교체는 **백업이 먼저**이고, 규정번호·규정명은 승계하며 검수상태는 미검수로 되돌린다
실행: python tools/test_corpus_replace.py
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import corpus_replace as CR  # noqa: E402

FM = """---
type: regulation
규정번호: "1999"
규정명: "합성규정"
분류: "9000_합성"
개정일: 2026-01-01
원본파일: "합성규정(2026년1월1일개정).hwpx"
태그: []
검수상태: 검수완료
---

"""
BODY = """# 합성규정

제1조(목적) 이 규정은 합성 테스트를 목적으로 한다.

제2조(정의) ① 합성이란 시험을 위해 만든 것을 말한다. ② 실제 규정이 아니다.

**부    칙**

제1조(시행일) 이 규정은 2026년 1월 1일부터 시행한다.

**부    칙**

제1조(시행일) 이 개정 규정은 2026년 3월 1일부터 시행한다.
"""


def test_supplementary_articles_are_scoped():
    """① 본칙 제1조와 부칙 제1조가 서로를 덮어쓰지 않는다."""
    a = CR.parse_articles(FM + BODY)
    assert len(a) == 4, list(a)
    assert "제1조" in a and "부칙1·제1조" in a and "부칙2·제1조" in a, list(a)
    assert "합성 테스트" in a["제1조"], a["제1조"][:40]


def test_identical_docs_show_no_change():
    """③ 같은 문서 = 변경 0. 형식 잡음이 새면 여기서 깨진다."""
    d = CR.diff_articles(FM + BODY, FM + BODY)
    assert d["요약"] == {"변경": 0, "신설": 0, "삭제": 0, "동일": 4}, d["요약"]


def test_new_supplementary_does_not_taint_previous_article():
    """② 부칙 추가 시 직전 조문이 '변경'으로 오탐되면 안 된다(꼬리 효과 회귀)."""
    new = BODY.rstrip() + "\n\n**부    칙**\n\n제1조(시행일) 이 개정 규정은 2026년 8월 1일부터 시행한다.\n"
    d = CR.diff_articles(FM + BODY, FM + new)
    assert d["요약"]["신설"] == 1, d["요약"]
    assert d["요약"]["변경"] == 0, (d["요약"], d["변경조"])


def test_article_change_is_detected_with_body_diff():
    """변경 조문은 본문 diff까지 나온다(운영자 선택 '나')."""
    new = BODY.replace("② 실제 규정이 아니다.", "② 실제 규정이 아니다. ③ 항이 하나 늘었다.")
    d = CR.diff_articles(FM + BODY, FM + new)
    assert d["요약"]["변경"] == 1 and d["변경조"] == ["제2조"], d["요약"]
    diff = d["항목"][0]["diff"]
    assert any(x.startswith("+") and "늘었다" in x for x in diff), diff


def test_replace_backs_up_and_resets_review():
    """④ 백업 우선 · 규정번호/규정명 승계 · 검수상태 미검수 복귀 · 개정일은 파일명에서."""
    with tempfile.TemporaryDirectory() as d:
        v = Path(d)
        rel = "20_규정원문/9000_합성/합성규정.md"
        (v / "20_규정원문/9000_합성").mkdir(parents=True)
        (v / rel).write_text(FM + BODY, encoding="utf-8")
        CR.LOG_PATH = v / "log.jsonl"          # 실로그 미접촉

        new_body = BODY.replace("합성 테스트를 목적으로", "개정된 목적으로")
        rec = CR.replace(v, rel, new_body, "합성규정(2026년8월1일개정).hwpx", actor="tester",
                         converter="kordoc+adapt")
        assert rec["개정일"] == "2026-08-01", rec
        assert (v / rec["backup"]).exists(), "백업이 없다 — 되돌릴 수 없는 교체는 금지"
        assert "합성 테스트를 목적으로" in (v / rec["backup"]).read_text(encoding="utf-8")

        after = (v / rel).read_text(encoding="utf-8")
        assert "검수상태: 미검수" in after, "내용이 바뀌었으면 다시 검수해야 한다"
        assert '규정번호: "1999"' in after and '규정명: "합성규정"' in after, "메타 승계 실패"
        assert "개정된 목적으로" in after
        assert any(r["event"] == "replace_done" for r in CR.read_log(5)), "로그가 없으면 고칠 수 없다"


def test_candidate_matching_prefers_reg_number():
    """매칭 우선순위: 규정번호 정확일치 > 규정명 일치. 번호 없는 파일명도 이름으로 찾는다.
    ⚠ 픽스처 번호는 **체계 내(1000~7999) 미사용 번호**여야 한다 — 9900 같은 체계 밖 번호는
      reg_no_of가 애초에 인식하지 않아 테스트가 거짓 실패한다(2026-08-04 실측)."""
    with tempfile.TemporaryDirectory() as d:
        v = Path(d)
        (v / "20_규정원문/9000_합성").mkdir(parents=True)
        (v / "20_규정원문/9000_합성/합성규정.md").write_text(FM + BODY, encoding="utf-8")
        by_no = CR.find_candidates(v, "1999_합성규정(2026년8월1일개정).hwpx")
        assert by_no and by_no[0]["score"] == 1.0, by_no
        by_name = CR.find_candidates(v, "합성규정(2026년8월1일개정).hwpx")
        assert by_name and by_name[0]["규정명"] == "합성규정", by_name


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
    sys.exit(1 if bad else print(f"\n✅ {len(fns)}개 통과 — 개정본 교체 엔진") or 0)
