#!/usr/bin/env python3
"""test_rag_core.py — rag_core 가드레일(면책 문구 보장) 단위 테스트.

LLM/임베딩 없이 순수 함수만 검증한다(빠름). 실행:  python tools/test_rag_core.py
가드레일(절대 규칙 #4): 모든 답변 끝에 '최종 판단은 …'. 모델이 누락해도 결정적으로 보장돼야 한다.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rag_core as rc  # noqa: E402

D = rc.DISCLAIMER


def test_appends_when_missing():
    out = rc._ensure_disclaimer("연차는 1년에 15일입니다. [복무규정 제19조]")
    assert out.endswith(D), out
    assert out.count(D) == 1


def test_no_double_when_present():
    txt = f"답변 본문. {D}"
    assert rc._ensure_disclaimer(txt) == txt  # 이미 있으면 그대로(중복 금지)


def test_key_phrase_variant_not_doubled():
    # 모델이 표현을 살짝 바꿔도 핵심 어구가 있으면 중복 안 붙임
    txt = "본문. 최종 판단은 담당 부서에 문의하세요."
    assert rc._ensure_disclaimer(txt).count("최종 판단은") == 1


def test_empty():
    assert rc._ensure_disclaimer("") == D
    assert rc._ensure_disclaimer("   ") == D


def test_stream_appends_when_missing():
    # answer_stream의 보장 로직과 동일한 규칙을 시뮬레이트(LLM 없이)
    chunks = ["연차는 ", "15일입니다. ", "[복무규정 제19조]"]
    seen = "".join(chunks)
    tail = ("\n\n" + D) if rc._DISC_KEY not in seen else ""
    assert tail and (seen + tail).endswith(D)


def test_stream_no_tail_when_present():
    seen = f"본문 {D}"
    tail = ("\n\n" + D) if rc._DISC_KEY not in seen else ""
    assert tail == ""


def test_cap_blocks_within_budget():
    # 예산 이내 → 전부 유지, 절단 없음
    blocks = ["a" * 100, "b" * 100]
    out, trunc = rc._cap_blocks(blocks)
    assert out == blocks and trunc is False


def test_cap_blocks_truncates_and_drops():
    # 예산 초과: 두 번째 블록은 절단 표기와 함께 잘리고, 세 번째는 제외 → srcs 동기화 시뮬레이트
    blocks = ["x" * (rc.CTX_MAX_CHARS - 1000), "y" * 3000, "z" * 3000]
    out, trunc = rc._cap_blocks(blocks)
    assert len(out) == 2 and trunc is True
    assert "일부 생략" in out[1]
    # retrieve()의 동기화 규칙: srcs를 len(blocks)로 자르고 마지막에 절단 마커
    srcs = [{"tag": "A"}, {"tag": "B"}, {"tag": "C"}]
    srcs[:] = srcs[: len(out)]
    if trunc and srcs:
        srcs[-1]["절단"] = True
    assert [s["tag"] for s in srcs] == ["A", "B"] and srcs[-1].get("절단") is True


def test_cap_blocks_no_meaningless_tail():
    # 남은 예산이 500자 미만이면 다음 블록을 아예 담지 않음(잘린 꼬리 방지)
    blocks = ["x" * (rc.CTX_MAX_CHARS - 100), "y" * 2000]
    out, trunc = rc._cap_blocks(blocks)
    assert len(out) == 1 and trunc is False


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"  ok  {fn.__name__}")
    print(f"\n✅ {len(fns)}개 테스트 통과 — 면책 문구 가드레일 보장")
