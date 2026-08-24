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


# ── 회차 간 비교 가능성(2026-08-23 수술) ─────────────────────────────────────────
# 계약: ④ 값은 안 바뀌고 **분모·구간만 붙는다** ⑤ 잡음 범위 판정은 결정적이다
#       ⑥ 누적 재시험은 **과거만** 본다(look-ahead 금지)

def test_ci_does_not_change_the_rate():
    """④ 신뢰구간을 붙여도 정답률 숫자는 한 자리도 바뀌지 않는다(조작 방지의 최소 조건)."""
    rows = [_q(1, "정답"), _q(2, "정답"), _q(3, "오답"), _q(4, "폐기")]
    v = R._acc(rows)
    assert v["정답률"] == 66.7 and v["분모"] == 3, v
    lo, hi = v["신뢰구간"]
    assert lo < 66.7 < hi, v
    # 구간은 항상 [0,100] 안 — 0%·100%에서 정규근사가 밖으로 나가는 것을 막는다
    assert R.wilson_ci(0, 10)[0] == 0.0 and R.wilson_ci(10, 10)[1] == 100.0
    assert R.wilson_ci(0, 0) == (None, None)
    # 표본이 커지면 구간이 좁아진다 = '분모를 늘리면 말할 자격이 생긴다'
    w46, w233 = R.wilson_ci(26, 46), R.wilson_ci(140, 233)
    assert (w46[1] - w46[0]) > (w233[1] - w233[0]) * 1.8, (w46, w233)


def test_noise_band_is_deterministic():
    """⑤ 직전 값이 오늘 구간 안이면 '잡음 범위' — 실측 08-22b(64.6%→54.3%, n=46)가 기준선."""
    ci = R.wilson_ci(25, 46)                       # 54.3%
    assert R.within_noise(64.6, ci), ci            # 실측: 10.3%p 스윙도 구간 안이었다
    assert not R.within_noise(95.0, ci), ci
    assert not R.within_noise(None, ci)
    assert not R.within_noise(60.0, [None, None])


def test_pooled_retry_never_looks_ahead():
    """⑥ 누적 재시험은 오늘까지만 본다 — 미래 회차를 넣으면 지표가 미래를 커닝한다."""
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        R.DAILY = tmp
        _write(tmp, "2026-05-01", [dict(_q(1, "정답"), 코호트="재시험")])
        _write(tmp, "2026-05-02", [dict(_q(2, "오답"), 코호트="재시험")])
        _write(tmp, "2026-05-03", [dict(_q(3, "오답"), 코호트="재시험")])   # 미래
        p = R.pooled_retry("2026-05-02")
        assert p["회차"] == ["2026-05-01", "2026-05-02"], p
        assert p["분모"] == 2 and p["정답률"] == 50.0, p
        # 창 크기를 넘으면 오래된 회차가 빠진다(추세 지표이지 누계가 아니다)
        assert R.pooled_retry("2026-05-03", k=1)["회차"] == ["2026-05-03"]


def test_noise_band_reaches_the_action_list():
    """잡음 범위 판정은 **행동 후보에도** 실린다 — 세션이 잡음을 수술하러 가면 안 된다."""
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        R.DAILY = tmp
        prev = [dict(_q(i, "정답" if i < 3 else "오답"), 코호트="재시험") for i in range(1, 5)]
        (tmp / "2026-06-01.graded.json").write_text(json.dumps(
            {"date": "2026-06-01", "정답률": 50.0, "집계": {},
             "코호트별": {"재시험": {"문항수": 4, "정답률": 50.0}}, "실패유형별": {},
             "문항": prev}, ensure_ascii=False), encoding="utf-8")
        today = [dict(_q(i, "오답" if i < 4 else "정답"), 코호트="재시험") for i in range(1, 5)]
        (tmp / "2026-06-02.graded.json").write_text(json.dumps(
            {"date": "2026-06-02", "정답률": 25.0, "집계": {},
             "코호트별": {"재시험": {"문항수": 4, "정답률": 25.0}}, "실패유형별": {},
             "문항": today}, ensure_ascii=False), encoding="utf-8")
        a = R.analyze("2026-06-02")
        assert a["직전재시험"] == 50.0, a["직전재시험"]
        assert any("잡음 범위" in x for x in a["행동후보"]), a["행동후보"]
        assert "잡음 범위" in R.render_md(a)


# ── 유형 구성 보정 — 2026-08-24 실측 ──────────────────────────────────────────
# 08-24 신규 정답률 93.6→86.5는 회귀로 보고됐으나, 복합형·거부형이 개수 상한(여정 16·
# 시드 19) 때문에 회차가 작아지면 비중만 3배로 뛰는 구조 때문이었다(5.5~6.3%→17.3%).
def test_standardized_rate_does_not_change_the_raw_rate():
    from daily_common import type_standardized
    rows = ([{"유형": "값형", "판정": "정답"}] * 9 + [{"유형": "값형", "판정": "오답"}]
            + [{"유형": "거부형", "판정": "오답"}] * 5)
    raw = 9 / 15
    st = type_standardized(rows)
    assert st["구성보정정답률"] is not None
    # ⛔ 보정치는 원시값을 대체하지 않는다 — 별도 필드로만 존재한다.
    assert "정답률" not in st, "보정 함수가 원시 정답률을 덮어쓰면 안 된다"
    # 거부형이 기준 구성(3.1%)보다 훨씬 많으므로 보정치는 원시값보다 **높아야** 한다.
    assert st["구성보정정답률"] > 100 * raw, (st, raw)
    assert st["하드유형비중"] == round(100 * 5 / 15, 1)


def test_standardized_rate_is_flat_when_mix_matches_reference():
    """구성이 기준과 같고 유형별 정답률이 같으면 보정치 == 원시값(자가 무해성)."""
    from daily_common import TYPE_REF_MIX, type_standardized
    rows = []
    for t, w in TYPE_REF_MIX.items():
        n = max(2, round(w * 200))
        rows += [{"유형": t, "판정": "정답"}] * (n // 2) + [{"유형": t, "판정": "오답"}] * (n - n // 2)
    st = type_standardized(rows)
    assert abs(st["구성보정정답률"] - 50.0) < 1.0, st


def test_partial_credit_is_bucketed_and_never_vanishes():
    """부분정답이 어느 버킷에도 없어 리포트에서 사라지던 구멍(08-24 6건)."""
    assert "부분정답" in R.NOISE, "부분정답이 버킷 없이 남으면 통계에서 사라진다"
    assert "부분정답" not in R.SURGERY, "부분정답은 서비스 결함 큐를 먹으면 안 된다"



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

