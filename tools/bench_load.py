#!/usr/bin/env python3
"""bench_load.py — RAG API 부하 실측(동시성 스윕): p50/p95 레이턴시 · 처리량(req/s).

목적: "서빙 TPS가 얼마인가"에 실측으로 답하기 위한 1회성 벤치. 단일 GPU + Ollama 구조에서
동시성을 1→2→4→8로 올리며 큐잉이 레이턴시에 어떻게 전가되는지 본다.

⛔ 대상은 기본 dev(9001) — prod(9000)에 돌리려면 BENCH_BASE를 명시하고 사용자 없는 시간에.
⚠ 해석 주의(정직성):
  - 토큰 수는 응답에 usage가 없어 문자수/2로 근사(한국어) — 절대값보다 스테이지 간 비교용.
  - 공유 GPU다. 시작 전 nvidia-smi로 유휴 확인 안 했으면 숫자는 오염일 수 있다.
  - 질문은 서로 다른 실사용형 8종 회전 — 동일 프롬프트 반복으로 생기는 착시 방지.
실행: cd tools && .venv/bin/python bench_load.py            (약 5~8분)
      BENCH_CONC="1,2" BENCH_N=4 로 축소 실행 가능
"""
import asyncio
import json
import os
import statistics
import time

import httpx

BASE = os.environ.get("BENCH_BASE", "http://127.0.0.1:9001/v1")
CONC = [int(x) for x in os.environ.get("BENCH_CONC", "1,2,4,8").split(",")]
N_PER_STAGE = int(os.environ.get("BENCH_N", "8"))
TIMEOUT = float(os.environ.get("BENCH_TIMEOUT", "240"))

# 실사용형 질문 8종 — 검색·생성이 실제 경로대로 도는, 서로 다른 주제
QUESTIONS = [
    "직원의 정년은 언제인가요?",
    "연차휴가는 어떻게 신청하나요?",
    "국내출장 여비는 어떻게 정산하나요?",
    "법인카드로 경조사비를 결제해도 되나요?",
    "74만원짜리 물품 구입은 누구 전결로 처리하나요?",
    "초과근무 수당은 어떻게 신청하나요?",
    "보안서약서는 언제 제출해야 하나요?",
    "육아휴직 복귀 후 근무시간 조정이 가능한가요?",
]


async def one(client: httpx.AsyncClient, q: str) -> dict:
    t0 = time.perf_counter()
    try:
        r = await client.post(f"{BASE}/chat/completions", json={
            "model": "kei-admin-rag",
            "messages": [{"role": "user", "content": q}],
        }, timeout=TIMEOUT)
        dt = time.perf_counter() - t0
        if r.status_code != 200:
            return {"ok": False, "s": dt, "err": f"HTTP {r.status_code}"}
        body = r.json()
        text = body["choices"][0]["message"]["content"]
        return {"ok": True, "s": dt, "chars": len(text)}
    except Exception as e:  # noqa: BLE001 — 벤치는 오류도 데이터다
        return {"ok": False, "s": time.perf_counter() - t0, "err": type(e).__name__}


async def stage(c: int) -> dict:
    sem = asyncio.Semaphore(c)
    qs = [QUESTIONS[i % len(QUESTIONS)] for i in range(N_PER_STAGE)]

    async def worker(q):
        async with sem:
            return await one(client, q)

    async with httpx.AsyncClient() as client:
        t0 = time.perf_counter()
        rs = await asyncio.gather(*(worker(q) for q in qs))
        wall = time.perf_counter() - t0
    ok = [r for r in rs if r["ok"]]
    lat = sorted(r["s"] for r in ok) or [0]
    chars = sum(r.get("chars", 0) for r in ok)
    return {
        "동시성": c, "요청": N_PER_STAGE, "성공": len(ok), "오류": N_PER_STAGE - len(ok),
        "wall_s": round(wall, 1),
        "p50_s": round(statistics.median(lat), 1),
        "p95_s": round(lat[max(0, int(len(lat) * 0.95) - 1)], 1),
        "max_s": round(lat[-1], 1),
        "req_per_s": round(len(ok) / wall, 3) if wall else 0,
        "req_per_min": round(len(ok) / wall * 60, 1) if wall else 0,
        "약식_tok_per_s": round(chars / 2 / wall, 1) if wall else 0,  # 한국어 ≈ 2자/토큰 근사
        "errs": sorted({str(r.get("err")) for r in rs if not r["ok"]}),
    }


async def main():
    print(f"대상 {BASE} · 스테이지 {CONC} · 스테이지당 {N_PER_STAGE}요청\n")
    results = []
    for c in CONC:
        r = await stage(c)
        results.append(r)
        print(f"c={c}: p50 {r['p50_s']}s · p95 {r['p95_s']}s · "
              f"{r['req_per_min']} req/min · ~{r['약식_tok_per_s']} tok/s"
              + (f" · ⚠오류 {r['오류']} {r['errs']}" if r["오류"] else ""))
    print("\n=== 요약(JSON) ===")
    print(json.dumps(results, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    asyncio.run(main())
