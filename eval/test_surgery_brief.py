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


def test_slack_gets_pointer_only():
    # ⛔ Slack엔 붙여넣기 한 줄만 — eval_notice가 surgery.md '존재'만 보고, 내용을 읽지 않는다.
    src = (HERE / "eval_notice.py").read_text(encoding="utf-8")
    assert "수술 브리핑 {date} 처리해" in src
    assert 'surgery.md").exists()' in src, "존재 확인이 아니라 내용을 싣고 있다"


def test_cron_wired_before_digest():
    sh = (HERE / "daily_run.sh").read_text(encoding="utf-8")
    assert sh.index("surgery_brief.py") < sh.index("--digest"), "브리핑이 다이제스트보다 뒤"


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
