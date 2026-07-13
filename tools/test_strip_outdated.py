#!/usr/bin/env python3
"""strip_outdated(02) 단위 테스트 — 최신값 단일화(docs/28 과업 A).

규약: 옛값은 `~~옛값~~ 현행값<!--outdated 날짜: 근거-->` 로 볼트에 남기되(웹은 취소선 렌더),
임베딩 텍스트에서는 취소선 구간과 outdated 주석을 제거해 RAG가 옛값을 검색하지 못하게 한다.
실행: cd tools && .venv/bin/python test_strip_outdated.py
"""
import importlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
m02 = importlib.import_module("02_chunk_and_embed")
strip = m02.strip_outdated

CASES = [
    # (입력, 기대 — 옛값·주석 제거, 이중 공백 없음)
    ("~~50만원~~ 100만원<!--outdated 2026-07-13: [[내부감사규정#별표 1]] 기준--> 초과",
     "100만원 초과"),
    ("| 음식물 | ~~3만원~~ 5만원<!--outdated 2026-07-13: 개정--> | 비고 |",
     "| 음식물 | 5만원 | 비고 |"),
    ("5 3 3 ~~1~~ 3", "5 3 3 3"),                       # 표 셀 안 최소 취소선
    ("~~문장 전체가 옛 서술~~\n현행: 새 서술", "\n현행: 새 서술"),
    ("일반 물결표 ~하나~는 보존", "일반 물결표 ~하나~는 보존"),
    ("취소선 없음 그대로", "취소선 없음 그대로"),
    ("<!--outdated 단독 주석-->본문", "본문"),
    # 여러 건이 한 줄에 있어도 각각 제거
    ("a ~~x~~ b ~~y~~ c", "a b c"),
]

fails = 0
for src, want in CASES:
    got = strip(src)
    ok = got == want
    fails += 0 if ok else 1
    print(("PASS" if ok else "FAIL"), repr(src)[:60], "→", repr(got)[:60])
    if not ok:
        print("      기대:", repr(want))

# 회귀 방지: 옛값 문자열이 결과에 남으면 안 됨
assert "3만원" not in strip("~~3만원~~ 5만원"), "옛값 누출"
assert "outdated" not in strip("x<!--outdated 2026-07-13: y-->"), "주석 누출"

print(f"\n{len(CASES) - fails}/{len(CASES)} 통과")
sys.exit(1 if fails else 0)
