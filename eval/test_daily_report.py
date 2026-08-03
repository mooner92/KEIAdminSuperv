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
