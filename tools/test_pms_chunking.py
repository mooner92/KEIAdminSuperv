#!/usr/bin/env python3
"""test_pms_chunking.py — PMS 상세가이드 청킹·회수 회귀 테스트.

검증 목표(2026-07-20 청킹 개편):
  ① 상세 청크가 **라벨(조)** 을 갖는다 — 개편 전엔 하위 섹션이 라벨 없이 들어갔다.
  ② 상세 청크가 **[화면명] 맥락**을 본문에 갖는다 — 어느 화면 소속인지 근거에 드러나야.
  ③ 화면 수만큼 '화면 개요' 청크가 있다(머리 블록도 라벨 보유).
  ④ 필드·버튼 수준 질의가 올바른 화면의 청크를 회수한다.

실행: cd tools && CHROMA_DIR=chroma RAG_COLLECTION=kei_regs .venv/bin/python test_pms_chunking.py
"""
import os
import re
import sys

import chromadb

DB = os.environ.get("CHROMA_DIR", "chroma")
COL = os.environ.get("RAG_COLLECTION", "kei_regs")
PREFIX = "연구관리시스템(PMS) 상세가이드"
fails = []


def ok(cond: bool, msg: str) -> None:
    print(("✅ " if cond else "❌ ") + msg)
    if not cond:
        fails.append(msg)


def main() -> int:
    col = chromadb.PersistentClient(path=DB).get_collection(COL)
    got = col.get(include=["metadatas", "documents"])
    rows = [(m, d) for m, d in zip(got["metadatas"], got["documents"])
            if m and str(m.get("규정명", "")).startswith(PREFIX)]
    ok(len(rows) > 0, f"① PMS 상세가이드 청크 존재 ({len(rows)}개)")

    # 탭 노트(부록·개요 제외)의 상세 청크만 대상.
    # ⚠ 노트 맨 앞 서문(경고 배너·관련 메뉴 링크)은 헤딩 이전 블록이라 라벨이 없는 게 정상 — 제외.
    tabs = [(m, d) for m, d in rows
            if "부록" not in m["규정명"] and not m["규정명"].endswith("개요")
            and not d.lstrip().startswith("> [!warning]")]
    labeled = [1 for m, _ in tabs if (m.get("조") or "").strip()]
    ok(len(labeled) == len(tabs),
       f"② 탭 청크 전부 라벨 보유 ({len(labeled)}/{len(tabs)})")

    # [화면명] 맥락 주입 — '화면 개요'가 아닌 하위 청크는 본문 첫 줄에 [화면] 이 있어야.
    # ⚠ '관련 규정'은 01e가 노트 레벨로 주입하는 섹션(특정 화면 소속 아님) — 제외.
    subs = [(m, d) for m, d in tabs
            if (m.get("조") or "") not in ("화면 개요", "관련 규정")]
    ctx = [1 for _, d in subs if re.match(r"^\s*\[[^\]\n]+\]", d)]
    ok(len(ctx) == len(subs), f"③ 하위 청크에 [화면명] 맥락 주입 ({len(ctx)}/{len(subs)})")

    n_overview = sum(1 for m, _ in tabs if (m.get("조") or "") == "화면 개요")
    ok(n_overview >= 70, f"④ '화면 개요' 청크 = 화면 수 규모 ({n_overview}개, 원본 화면 76)")

    # ⑤ 회수 — 필드·버튼 수준 질의가 올바른 화면 청크로
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import rag_core  # noqa: PLC0415

    # retrieve → (근거 컨텍스트 문자열, 구조화 출처 리스트)
    cases = [
        ("연구실적 년차확정 버튼", "년차확정"),
        ("자문위원선정 화면 검색조건", "자문위원"),
        ("보고서 발간요청 업무 흐름", "발간요청"),
        ("원고 감수 이의신청 절차", "이의"),
    ]
    for q, expect in cases:
        ctx, _srcs = rag_core.retrieve(q, k=3, rerank=False)
        ok(expect in ctx, f"⑤ '{q}' → 근거에 '{expect}' 포함")

    # ⑥ 근거 출처에 화면명이 드러나는가(개편의 목적) — 라벨 또는 [화면] 맥락
    ctx, _ = rag_core.retrieve("연구실적 년차확정 버튼", k=3, rerank=False)
    ok(re.search(r"\[[^\]\n]*연구실적[^\]\n]*\]", ctx) is not None,
       "⑥ 근거 컨텍스트에 화면명이 표기됨")

    print(f"\n{'❌ ' + str(len(fails)) + '건 실패' if fails else '✅ 전부 통과'}")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
