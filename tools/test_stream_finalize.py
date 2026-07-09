#!/usr/bin/env python3
"""test_stream_finalize.py — v1 스펙 B4: 스트림 종료 텍스트 확정 3분기 유닛.

절대 규칙1 방어: 오류로 반 잘린 답이 '완성된 답'으로 저장되지 않아야 한다.
실행: APP_DB=/tmp/test-app.db .venv/bin/python tools/test_stream_finalize.py
"""
import os
import sys
from pathlib import Path

os.environ.setdefault("APP_DB", "/tmp/kei-test-app.db")  # 실제 app.db 미접촉
sys.path.insert(0, str(Path(__file__).resolve().parent))
from app_api import STREAM_TRUNCATED_MARK, finalize_stream_text  # noqa: E402


def test_normal_passthrough():
    assert finalize_stream_text("정상 답변입니다.", None) == "정상 답변입니다."


def test_normal_but_empty():
    out = finalize_stream_text("", None)
    assert "다시 시도" in out


def test_error_with_partial_gets_marker():
    out = finalize_stream_text("여비는 규정에 따라", "ReadTimeout")
    assert out.startswith("여비는 규정에 따라")          # 부분 응답 보존
    assert STREAM_TRUNCATED_MARK in out                  # 절단 마커 부착(완성 답 위장 방지)
    assert "ReadTimeout" in out


def test_error_empty_connection_notice():
    out = finalize_stream_text("", "ConnectError")
    assert "연결하지 못했습니다" in out and "ConnectError" in out
    assert STREAM_TRUNCATED_MARK not in out              # 빈 응답은 절단이 아니라 실패


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"  ok  {fn.__name__}")
    print(f"\n✅ {len(fns)}개 테스트 통과 — 스트림 절단 정직성(B4)")
