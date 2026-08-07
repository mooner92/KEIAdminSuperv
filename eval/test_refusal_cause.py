#!/usr/bin/env python3
"""test_refusal_cause.py — 거부 원인 분류 단일 정본 회귀(2026-08-06).

## 왜 생겼나 (실측)

축 채점기 5곳(axes 4 + scenarios 1)이 `is_refusal(답변)` 하나만 보고 원인을 '검색실패'로
찍고 있었다. **근거가 실제로 회수됐는지는 보지 않았다.** 그 결과:

  · 검색실패 56건 중 **9건(16%)이 오분류**
  · dq-2026-07-30b-a02는 **7회차 연속** 같은 오분류로 매일 수술대기에 올랐다
  · '사적이해관계자' 건은 근거(제12조)가 정확히 회수됐는데도 검색 탓으로 기록돼,
    진짜 원인(defterms 인덱스가 별첨 인용 법령을 본문 조문에 오귀속)이 라벨 뒤에 숨었다

⛔ 픽스처는 전부 합성이다(코드 전용 레포 — 데이터 분리 원칙).
못박는 계약:
  ① 근거 **미회수** + 거부 → 검색실패
  ② 근거 **회수됨** + 거부 → 근거부적합 (검색 개선 대상이 아니다)
  ③ 조 가지번호(제5조의3)는 본조(제5조)로도 일치시킨다 — 표기 차이로 오분류되면 안 된다
  ④ 복합 시나리오(출처들 여러 개)는 **하나라도** 회수됐으면 근거부적합
실행: cd eval && ../tools/.venv/bin/python test_refusal_cause.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from daily_common import refusal_cause, retrieved_expected  # noqa: E402


def _item(출처, x):
    return {"출처": 출처, "x_sources": x}


def test_missed_retrieval_is_search_failure():
    """① 기대 근거가 안 붙었으면 검색실패가 맞다(기존 동작 보존)."""
    it = _item({"규정명": "합성규정", "조": "제3조"},
               [{"규정명": "다른규정", "조": "제9조"}])
    assert retrieved_expected(it) is False
    assert refusal_cause(it) == "검색실패"


def test_retrieved_but_refused_is_evidence_unfit():
    """② 근거는 붙었는데 거부 — 검색 탓이 아니다. 이게 9건 오분류의 정체다."""
    it = _item({"규정명": "합성규정", "조": "제12조"},
               [{"규정명": "합성규정", "조": "제12조"}])
    assert retrieved_expected(it) is True
    assert refusal_cause(it) == "근거부적합"


def test_branch_article_matches_base_article():
    """③ 제5조의3을 기대할 때 제5조 청크가 붙어도 회수된 것으로 본다(표기 차이 흡수)."""
    it = _item({"규정명": "합성규정", "조": "제5조의3"},
               [{"규정명": "합성규정", "조": "제5조"}])
    assert refusal_cause(it) == "근거부적합"


def test_article_free_source_matches_by_regulation_only():
    """조가 비어 있으면 규정명만으로 판정한다(축 문항 중 조 미지정 케이스)."""
    it = _item({"규정명": "합성규정", "조": ""}, [{"규정명": "합성규정", "조": "제99조"}])
    assert refusal_cause(it) == "근거부적합"


def test_scenario_multi_source_any_hit():
    """④ 복합 시나리오는 출처가 여럿 — 하나라도 회수됐으면 검색은 제 일을 한 것이다."""
    it = {"출처": {}, "출처들": [{"규정명": "A규정", "조": "제1조"},
                                  {"규정명": "B규정", "조": "제2조"}],
          "x_sources": [{"규정명": "B규정", "조": "제2조"}]}
    assert refusal_cause(it) == "근거부적합"
    it2 = {**it, "x_sources": [{"규정명": "C규정", "조": "제7조"}]}
    assert refusal_cause(it2) == "검색실패"


def test_empty_sources_never_crash():
    """근거가 아예 없거나 필드가 비어도 죽지 않는다(채점 중단 금지)."""
    assert refusal_cause({"출처": {"규정명": "합성규정", "조": "제1조"}}) == "검색실패"
    assert refusal_cause({}) == "검색실패"


def test_graders_use_the_single_source_of_truth():
    """⛔ 축 채점기가 '검색실패'를 다시 하드코딩하지 않는지 소스로 지킨다.
    (refusal_detect가 정규식 복제를 금지하는 것과 같은 이유 — 규칙이 갈라지면 통계가 갈라진다)"""
    here = Path(__file__).resolve().parent
    for name in ("axes.py", "scenarios.py"):
        src = (here / name).read_text(encoding="utf-8")
        assert ', "검색실패"' not in src, f"{name}: 거부 원인을 하드코딩했다 — refusal_cause(item)를 쓸 것"
        assert "refusal_cause" in src, f"{name}: 단일 정본을 임포트하지 않았다"


def test_new_cause_reaches_report_not_미분류():
    """⛔ 원인이 신설되면 **집계까지 살아서 가야** 한다.

    2026-08-07 실측: 전날 신설한 '근거부적합'을 classify_failure 화이트리스트에 넣지 않아
    2건이 '미분류'로 떨어졌고, 수술대기 목록에서 통째로 사라졌다(리포트엔 9건만 표시).
    분류기 구멍이 '정상'처럼 보이는 통계가 되는 게 가장 나쁘다 — 경로 전체를 회귀로 잡는다."""
    import daily_grade as G
    import daily_report as R
    item = {"판정": "오답", "골든": "합성 근거 문장", "원인": "근거부적합"}
    assert G.classify_failure(item) == "근거부적합", G.classify_failure(item)
    assert "근거부적합" in R.SURGERY, R.SURGERY


def test_causes_and_report_buckets_stay_in_sync():
    """원인 화이트리스트와 리포트 버킷(SURGERY∪NOISE)이 갈라지면 조용히 유실된다.
    새 원인을 한쪽에만 넣는 실수를 구조적으로 막는다."""
    import re as _re

    import daily_report as R
    src = (Path(__file__).resolve().parent / "daily_grade.py").read_text(encoding="utf-8")
    m = _re.search(r'if cause in \(([^)]*)\)', src)
    assert m, "classify_failure의 원인 화이트리스트를 찾지 못함"
    causes = {c.strip().strip('"\'') for c in m.group(1).split(",") if c.strip()}
    buckets = set(R.SURGERY) | set(R.NOISE)
    # 원문결함·시드재검토는 별도 취급(측정/원문 계열) — 나머지는 반드시 버킷에 있어야 한다
    orphan = causes - buckets - {"원문결함", "시드재검토"}
    assert not orphan, f"버킷 없는 원인(집계에서 유실됨): {orphan}"


def test_graders_receive_answer_merged_item():
    """⛔ daily_grade는 채점기에 item(=질문+답변)을 넘겨야 한다. q만 넘기면 x_sources가 없어
    원인 분류가 항상 '검색실패'로 샌다 — 이 회귀가 그 재발을 막는다."""
    src = (Path(__file__).resolve().parent / "daily_grade.py").read_text(encoding="utf-8")
    assert "axes.grade(item, 답변)" in src, "axes.grade에 q를 넘기고 있다"
    assert "scenarios.grade_scenario(item, 답변)" in src, "grade_scenario에 q를 넘기고 있다"


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
    sys.exit(1 if bad else print(f"\n✅ {len(fns)}개 통과 — 거부 원인 분류 단일 정본") or 0)
