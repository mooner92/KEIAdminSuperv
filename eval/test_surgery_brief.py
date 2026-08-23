# 수술 브리핑 회귀 — 합성 픽스처만(실데이터 미사용).
import json
import sys
from pathlib import Path

import daily_report
import surgery_brief

HERE = Path(__file__).resolve().parent
FIX_DATE = "9999-01-01"   # 실측 파일과 절대 충돌하지 않는 합성 날짜


def test_surgery_set_matches_report():
    # 분류 정본은 daily_report — 브리핑이 다른 집합을 쓰면 분석서와 건수가 어긋난다.
    assert set(surgery_brief.SURGERY) == set(daily_report.SURGERY)


def test_build_and_paste_line_contract():
    g = {"date": FIX_DATE, "문항": [
        {"id": "t1", "질문": "합성 질문?", "골든": "합성 골든", "답변": "합성 답변",
         "실패유형": "검색실패", "판정": "오답", "유형": "사실형", "코호트": "신규",
         "출처": {"규정명": "합성규정", "조": "제1조"},
         "x_sources": [{"규정명": "다른규정", "조": "제2조", "rerank": True}],
         "x_gates": {"routes": {"rerank": 1}, "절단": False}},
        {"id": "t2", "질문": "노이즈", "실패유형": "출제결함", "판정": "오답",
         "유형": "사실형", "코호트": "신규"},
    ]}
    gf = surgery_brief.DAILY / f"{FIX_DATE}.graded.json"
    gf.write_text(json.dumps(g, ensure_ascii=False), encoding="utf-8")
    try:
        out = surgery_brief.build(FIX_DATE)
        assert out and out.exists()
        md = out.read_text(encoding="utf-8")
        assert "수술대기 1건" in md, "노이즈(출제결함)가 브리핑에 섞였다"
        assert "합성 질문?" in md and "합성 골든" in md and "제1조 — ❌" in md
        assert "패치노트 **분류: 개선**" in md, "세션 계약(패치노트 개선)이 머리에 없다"
        assert "규정 내용 추측 금지" in md
    finally:
        gf.unlink(missing_ok=True)
        (surgery_brief.DAILY / f"{FIX_DATE}.surgery.md").unlink(missing_ok=True)


def test_newly_broken_always_included_even_outside_surgery_set():
    # 2026-08-20 실측: 새로깨짐 2건 중 1건이 '골든품질'이라 브리핑에서 통째로 빠졌다.
    # "어제 맞히던 게 오늘 깨졌다"는 분류와 무관하게 최우선으로 실려야 한다(+맨 앞).
    g = {"date": FIX_DATE, "문항": [
        {"id": "surgcase", "질문": "수술대기 질문?", "골든": "g", "답변": "a",
         "실패유형": "검색실패", "판정": "오답", "유형": "사실형", "코호트": "신규"},
        {"id": "brokecase", "질문": "어제 맞히던 질문?", "골든": "g", "답변": "a",
         "실패유형": "골든품질", "판정": "오답", "유형": "사실형",
         "코호트": "재시험", "직전판정": "정답"},
        {"id": "chroniccase", "질문": "묵은 부채?", "골든": "g", "답변": "a",
         "실패유형": "생성환각", "판정": "오답", "유형": "사실형",
         "코호트": "재시험", "직전판정": "오답"},
        {"id": "unscoredcase", "질문": "폐기?", "실패유형": "출제결함", "판정": "폐기",
         "유형": "사실형", "코호트": "재시험", "직전판정": "정답"},
    ]}
    gf = surgery_brief.DAILY / f"{FIX_DATE}.graded.json"
    gf.write_text(json.dumps(g, ensure_ascii=False), encoding="utf-8")
    try:
        md = surgery_brief.build(FIX_DATE).read_text(encoding="utf-8")
        assert "수술대기 2건" in md, "수술대기 건수는 기존 3종 집합 그대로여야 한다(분석서와 대사)"
        assert "🔻새로깨짐 2건" not in md and "🔻새로깨짐 1건" in md, "만성(직전=오답)까지 셌다"
        assert "수술대기 분류 밖" in md, "분류 밖 편입 사실이 머리에 안 보인다"
        assert md.index("brokecase") < md.index("surgcase"), "새로깨짐이 맨 앞이 아니다"
        assert "unscoredcase" not in md, "폐기·판정불가는 새로깨짐이 아니다(채점 미성립)"
        assert md.count("🔻새로깨짐 [") == 1
    finally:
        gf.unlink(missing_ok=True)
        (surgery_brief.DAILY / f"{FIX_DATE}.surgery.md").unlink(missing_ok=True)


def test_slack_gets_pointer_only():
    # ⛔ Slack엔 붙여넣기 한 줄만 — eval_notice가 surgery.md '존재'만 보고, 내용을 읽지 않는다.
    src = (HERE / "eval_notice.py").read_text(encoding="utf-8")
    assert "수술 브리핑 {date} 처리해" in src
    assert 'surgery.md").exists()' in src, "존재 확인이 아니라 내용을 싣고 있다"


def test_cron_wired_before_digest():
    sh = (HERE / "daily_run.sh").read_text(encoding="utf-8")
    assert sh.index("surgery_brief.py") < sh.index("--digest"), "브리핑이 다이제스트보다 뒤"


def test_header_carries_denominator_and_interval():
    """회차 지표 머리줄은 **분모와 95% 구간**을 달고 나온다(2026-08-23 수술).

    실측 사고: 재시험 64.6%→54.3%(둘 다 n≈46)를 구조 결함으로 읽고 3일치를 추적했다가
    전량 기각됐다. 분모가 안 보이면 세션은 잡음을 회귀로 오진한다.
    ⛔ 정답률 값 자체는 그대로여야 한다 — 구간은 해석을 돕지 값을 바꾸지 않는다.
    """
    g = {"date": FIX_DATE, "정답률": 89.2,
         "코호트별": {"재시험": {"문항수": 3, "정답률": 33.3}},
         "문항": [
             {"id": "r1", "질문": "합성?", "골든": "g", "답변": "a", "실패유형": "검색실패",
              "판정": "오답", "유형": "사실형", "코호트": "재시험"},
             {"id": "r2", "질문": "합성2?", "판정": "오답", "유형": "사실형", "코호트": "재시험"},
             {"id": "r3", "질문": "합성3?", "판정": "정답", "유형": "사실형", "코호트": "재시험"},
         ]}
    gf = surgery_brief.DAILY / f"{FIX_DATE}.graded.json"
    gf.write_text(json.dumps(g, ensure_ascii=False), encoding="utf-8")
    try:
        md = surgery_brief.build(FIX_DATE).read_text(encoding="utf-8")
        assert "재시험 33.3%" in md, md.split("\n")[2]
        assert "n=3" in md and "95% 구간" in md, md.split("\n")[2]
        assert "잡음" in md
    finally:
        gf.unlink(missing_ok=True)
        (surgery_brief.DAILY / f"{FIX_DATE}.surgery.md").unlink(missing_ok=True)


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
    sys.exit(1 if bad else print(f"\n✅ {len(fns)}개 통과 — 수술 브리핑 계약(분류 대사·유출 금지·배선)") or 0)
