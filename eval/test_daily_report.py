#!/usr/bin/env python3
"""test_daily_report.py — 아침 분석서(1단) 회귀.

⛔ 픽스처는 **전부 합성**이다 — 이 레포는 코드 전용이라 실제 규정 문구·실제 답변을
   테스트에 박지 않는다(데이터 분리 원칙). 검증 대상은 집계 규칙이지 내용이 아니다.
못박는 계약:
  ① 정답률 분모에서 폐기·판정불가를 뺀다 — 시험지 결함이 서비스 점수를 깎으면 안 된다
  ② 수술 대기(검색실패·생성환각)와 측정 노이즈(출제결함·골든품질)를 섞지 않는다
  ③ 어휘 갭은 문서어·일상어가 **둘 다 있을 때만** 계산한다(한쪽뿐이면 갭이 아니다)
실행: cd eval && ../tools/.venv/bin/python test_daily_report.py
"""
import collections
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import daily_report as R  # noqa: E402


def _q(i, 판정, 어휘층=None, 실패유형=None, **kw):
    return {"id": f"dq-{i}", "hash": f"h{i}", "질문": f"합성 질문 {i} 맞나요?", "판정": 판정,
            "어휘층": 어휘층, "실패유형": 실패유형, "주제": ["합성주제"],
            "출처": {"규정명": "합성규정", "조": "제1조"}, "증거": "합성 증거", **kw}


def _write(tmp, date, items, 정답률=90.0):
    (tmp / f"{date}.graded.json").write_text(json.dumps(
        {"date": date, "정답률": 정답률, "집계": {}, "코호트별": {}, "실패유형별": {},
         "문항": items}, ensure_ascii=False), encoding="utf-8")


def test_discarded_items_leave_denominator():
    """① 폐기·판정불가는 분모 밖 — 3정답 1오답 2폐기면 75%지 50%가 아니다."""
    c = collections.Counter({"정답": 3, "오답": 1, "폐기": 1, "판정불가": 1})
    assert R._rate(c) == 75.0, R._rate(c)
    assert R._rate(collections.Counter()) == 0.0


def test_surgery_and_noise_are_separated():
    """② 이 분리가 리포트의 존재 이유다 — 섞이면 '오답 N건'으로 뭉개진다."""
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        R.DAILY = tmp
        items = [_q(1, "오답", "문서어", "검색실패"), _q(2, "오답", "일상어", "생성환각"),
                 _q(3, "폐기", "일상어", "출제결함"), _q(4, "판정불가", "문서어", "골든품질"),
                 _q(5, "정답", "문서어")]
        _write(tmp, "2026-01-01", items)
        a = R.analyze("2026-01-01")
        assert len(a["수술대기"]) == 2, a["수술대기"]
        assert a["측정노이즈"] == {"출제결함": 1, "골든품질": 1}, a["측정노이즈"]
        assert {s["실패유형"] for s in a["수술대기"]} == {"검색실패", "생성환각"}


def test_gap_needs_both_layers():
    """③ 한쪽 어휘층만 있으면 갭은 None — 없는 비교를 만들어내지 않는다."""
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        R.DAILY = tmp
        _write(tmp, "2026-01-02", [_q(1, "정답", "문서어"), _q(2, "오답", "문서어", "검색실패")])
        assert R.analyze("2026-01-02")["어휘갭"] is None
        _write(tmp, "2026-01-03", [_q(1, "정답", "문서어"), _q(2, "정답", "문서어"),
                                   _q(3, "오답", "일상어", "검색실패"), _q(4, "정답", "일상어")])
        a = R.analyze("2026-01-03")
        assert a["어휘갭"]["정답률차"] == 50.0, a["어휘갭"]        # 100% vs 50%
        assert a["어휘층"]["일상어"]["검색실패율"] == 50.0


def test_pair_mismatch_needs_both_sides():
    """짝 불일치는 일상어의 쌍id가 문서어 hash에 걸릴 때만 — 한쪽만 있으면 조인 실패(실측 결함)."""
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        R.DAILY = tmp
        _write(tmp, "2026-01-04", [_q(1, "정답", "문서어"),
                                   _q(2, "오답", "일상어", "검색실패", 쌍id="h1")])
        a = R.analyze("2026-01-04")
        assert len(a["짝불일치"]) == 1 and a["짝불일치"][0]["일상어판정"] == "오답"


def test_actions_are_evidence_backed():
    """행동 후보는 근거 수치를 달고 나온다 — 수치 없는 권고는 추측이다."""
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        R.DAILY = tmp
        _write(tmp, "2026-01-05", [_q(1, "정답", "문서어"), _q(2, "정답", "문서어"),
                                   _q(3, "오답", "일상어", "검색실패"), _q(4, "정답", "일상어")])
        a = R.analyze("2026-01-05")
        joined = " ".join(a["행동후보"])
        assert "%p" in joined and "검색실패 1건" in joined, a["행동후보"]
        assert R.render_md(a).startswith("# 품질 분석서 · 2026-01-05")


def test_clean_day_says_so():
    """수술 대기 0건이면 '특이 없음' — 매일 억지 권고를 만들지 않는다(알림 피로 방지)."""
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        R.DAILY = tmp
        _write(tmp, "2026-01-06", [_q(1, "정답", "문서어"), _q(2, "정답", "일상어")])
        assert R.analyze("2026-01-06")["행동후보"] == ["특이 없음 — 수술 대기 0건"]


def test_evidence_unfit_is_surgery_not_search_failure():
    """'근거부적합'(2026-08-06 신설)은 수술대기에 뜨되 **검색실패와 섞이지 않는다**.

    실측 배경: 축 채점기 5곳이 거부만 보고 검색실패를 찍어 56건 중 9건이 오분류됐고,
    그중 1건은 7회차 연속 잘못 집계됐다. 라벨이 섞이면 개선 방향이 어긋난다."""
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        R.DAILY = tmp
        _write(tmp, "2026-01-07", [
            _q(1, "오답", "문서어", "검색실패"),
            _q(2, "오답", "일상어", "근거부적합"),
            _q(3, "정답", "문서어"),
        ])
        r = R.analyze("2026-01-07")
        types = [s["실패유형"] for s in r["수술대기"]]
        assert sorted(types) == ["검색실패", "근거부적합"], types      # 둘 다 수술대기
        assert r["측정노이즈"].get("근거부적합", 0) == 0, r["측정노이즈"]  # 노이즈 아님
        # 어휘층 '검색실패' 집계에는 근거부적합이 섞이면 안 된다(검색 지표 오염 금지)
        assert r["어휘층"]["일상어"]["검색실패"] == 0, r["어휘층"]["일상어"]
        acts = " / ".join(r["행동후보"])
        assert "근거부적합 1건" in acts and "인덱스 귀속" in acts, acts


def test_chronic_track_splits_retry_cohort():
    """만성 분해(2026-08-19): 재시험 한 숫자에 섞인 '오늘 새로 깨진 것'과 '묵은 부채'를 가른다.

    ⛔ 합산 정답률·코호트별은 건드리지 않는다 — 표시용 분해만 얹는다.
    ⛔ 만성 판정은 그 회차 **시작 시점 이력**만 본다(look-ahead 금지).
    """
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        R.DAILY = tmp
        # 1~3회차: q1은 계속 오답(→ 4회차 시작 시점에 만성), q2는 계속 정답
        for day in ("2026-02-01", "2026-02-02", "2026-02-03"):
            _write(tmp, day, [dict(_q(1, "오답", "문서어", "생성환각"), 코호트="재시험"),
                              dict(_q(2, "정답", "문서어"), 코호트="재시험")])
        # 4회차: q1 여전히 오답(만성) · q2 처음 오답(= 오늘 새로 깨진 것)
        _write(tmp, "2026-02-04", [dict(_q(1, "오답", "문서어", "생성환각"), 코호트="재시험"),
                                   dict(_q(2, "오답", "문서어", "검색실패"), 코호트="재시험")])
        a = R.analyze("2026-02-04")
        ct = a["만성트랙"]
        assert ct["만성"]["문항수"] == 1 and ct["만성"]["정답률"] == 0.0, ct["만성"]
        assert ct["재시험_만성제외"]["문항수"] == 1, ct["재시험_만성제외"]
        assert ct["신규회귀"] == {"건수": 1, "분모_직전정답": 1, "비율": 100.0}, ct["신규회귀"]
        assert ct.get("그림자") is True                      # 과거 파일 재작성 없이 재구성
        md = R.render_md(a)
        assert "만성 제외 재시험" in md and "계속 출제한다" in md, md
        acts = " / ".join(a["행동후보"])
        assert "만성(고착 부채) 1건" in acts and "새로 깨진" in acts, acts


def test_chronic_track_prefers_stored_over_shadow():
    """daily_grade가 회차에 새겨둔 값이 있으면 그대로 쓴다 — 재계산으로 수치가 갈리면 안 된다."""
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        R.DAILY = tmp
        items = [dict(_q(1, "오답", "문서어", "생성환각"), 코호트="재시험")]
        (tmp / "2026-03-01.graded.json").write_text(json.dumps(
            {"date": "2026-03-01", "정답률": 0.0, "집계": {}, "코호트별": {}, "실패유형별": {},
             "만성트랙": {"기준": "고정값", "만성": {"문항수": 9, "정답률": 11.1},
                       "재시험_만성제외": {"문항수": 1, "정답률": 0.0},
                       "신규회귀": {"건수": 0, "분모_직전정답": 0, "비율": None}},
             "문항": items}, ensure_ascii=False), encoding="utf-8")
        ct = R.analyze("2026-03-01")["만성트랙"]
        assert ct["만성"]["문항수"] == 9 and ct.get("그림자") is None, ct


def test_chronic_absent_when_no_retry_cohort():
    """만성이 0이면 리포트에 분해 섹션이 아예 안 뜬다 — 없는 부채를 만들어 보이지 않는다."""
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        R.DAILY = tmp
        _write(tmp, "2026-04-01", [_q(1, "정답", "문서어"), _q(2, "정답", "일상어")])
        a = R.analyze("2026-04-01")
        assert a["만성트랙"]["만성"]["문항수"] == 0
        assert "만성 제외 재시험" not in R.render_md(a)


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
    sys.exit(1 if bad else print(f"\n✅ {len(fns)}개 통과 — 아침 분석서 집계 규칙") or 0)
