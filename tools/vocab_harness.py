#!/usr/bin/env python3
"""vocab_harness.py — 어휘 채널 성적표(docs/71 P1, 2026-08-13).

전수조사(vocab_dilution_audit.json)의 위험 용어 50종 + 실사례를 **현재 검색 구성**으로
자동 채점한다. P2(리랭크 풀 확대)·P3(BM25 하이브리드)의 합격/불합격을 이 성적표로 판정.

측정 2종(용어별):
  ⓐ dense 순위 — 원시 밀집 top-40에서 용어 포함 청크의 첫 순위(채널 자체의 정렬력)
  ⓑ 서비스 최종 — 실제 retrieve()(rerank·hybrid는 현재 env) top-k 컨텍스트에 용어 포함?

A/B 사용법(env가 조작 변수 — 코드 불변):
  기준선:  .venv/bin/python vocab_harness.py --tag baseline
  P2:      RAG_RERANK_POOL=40 .venv/bin/python vocab_harness.py --tag pool40
  P3:      RAG_HYBRID=1 [RAG_RERANK_POOL=40] .venv/bin/python vocab_harness.py --tag hybrid
결과: tools/index/vocab_harness-<tag>.json + 표준출력 요약. LLM 0회·결정적.

⚠ 한계(정직): ⓑ는 retrieve()가 돌려준 컨텍스트 문자열 포함 검사라, 블록 절단으로 용어가
잘리는 극단 케이스는 미탐일 수 있다(순위 존재 판단엔 실용상 충분).
"""
import argparse
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent

# 실사례(브리핑·운영자 스크린샷 실측) — 용어 단독이 아니라 '희석된 문장'으로 진 케이스
REAL_CASES = [
    {"용어": "여입", "질문": "출장비 여입신청은 어디로 해야 해?"},
    {"용어": "매각", "질문": "매각 건으로 126만원을 집행하려는데 전결권자는 누구인가요?"},
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True, help="구성 이름(예: baseline, pool40, hybrid)")
    ap.add_argument("--k", type=int, default=5, help="서비스 최종 top-k(기본 5)")
    a = ap.parse_args()

    import rag_core as rc
    embed, col, _ = rc.backend()

    audit = json.loads((HERE / "index" / "vocab_dilution_audit.json").read_text(encoding="utf-8"))
    cases = [{"용어": o["용어"], "질문": f"{o['용어']} 신청은 어디로 해야 해?"}
             for o in audit.get("풀밖(>20/부재)", []) + audit.get("리랭크의존(6~20)", [])
             if o["용어"] != "README"] + REAL_CASES

    results = []
    for c in cases:
        term, q = c["용어"], c["질문"]
        # ⓐ dense 순위(원시 채널)
        qv = embed.encode([q], normalize_embeddings=True).tolist()
        r = col.query(query_embeddings=qv, n_results=40, include=["documents"])
        dense_rank = next((i for i, d in enumerate(r["documents"][0], 1) if term in d), None)
        # ⓑ 서비스 최종(현재 env 구성 그대로)
        context, srcs = rc.retrieve(q, k=a.k)
        final_hit = term in (context or "")
        results.append({"용어": term, "질문": q, "dense순위": dense_rank, "최종포함": final_hit})

    n = len(results)
    hit = sum(1 for r in results if r["최종포함"])
    pool = rc.RERANK_POOL
    in_pool = sum(1 for r in results if r["dense순위"] and r["dense순위"] <= pool)
    out = {"config": {"tag": a.tag, "hybrid": os.environ.get("RAG_HYBRID", "0"),
                      "rerank_pool": pool, "k": a.k},
           "요약": {"케이스": n, "최종포함": hit, "풀진입": in_pool},
           "케이스": results}
    dst = HERE / "index" / f"vocab_harness-{a.tag}.json"
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"[{a.tag}] hybrid={out['config']['hybrid']} pool={pool} k={a.k}")
    print(f"  케이스 {n} · 최종 top-{a.k} 포함 {hit} ({100*hit//n}%) · 리랭크 풀 진입 {in_pool}")
    fails = [r for r in results if not r["최종포함"]]
    print(f"  실패 {len(fails)}: " + ", ".join(f"{r['용어']}({r['dense순위'] or '40+'})" for r in fails[:15]))
    print(f"  → {dst.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
