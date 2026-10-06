#!/usr/bin/env python3
"""daily_answer.py — 일일 자가평가 ② 실서비스 답변 수집(docs/58 §2).

실서비스 동등(/v1 — 리랭커 등 서비스 구성 그대로, 평가 전용 env 금지). 문항당 독립 단발.
실행: .venv/bin/python eval/daily_answer.py [--date YYYY-MM-DD]
"""
import argparse
import datetime
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

_GATE_KEYS = ("rerank", "graph_expand", "graph_expand_reg", "defterm_route",
              "amount_route", "impact_route", "graph_expand_action",
              "graph_expand_gian", "scope_anchor", "value_store",
              "procedure_pack", "uplaw", "표깨짐", "절단", "효력",
              "refusal_retry")
from daily_common import ANSWER_MODEL, API, DAILY_DIR, rag_answer


# 동시 답변 수(docs/74) — 기본 1(종전과 동일 순차). 에이전트 경로는 문항당 수 분이라 전용 Ollama가
# 병렬 슬롯을 가질 때만 2 이상으로 올린다(서버 측 동시 에이전트 상한 RAG_AGENT_CONCURRENCY와 맞출 것).
WORKERS = max(1, int(os.environ.get("DAILY_EVAL_WORKERS", "1")))


def answer_one(q: dict) -> dict:
    """문항 1개 답변 수집(빈 답변/오류 시 1회 재시도). 실패하면 '오류' 필드를 단 빈 답변."""
    ans = {"id": q["id"], "답변": "", "x_sources": [], "오류": "미수집"}
    for attempt in range(2):  # 빈 답변/오류 시 1회 재시도(일시적 서버 부하 대비)
        try:
            t = time.time()
            # 복합 시나리오의 멀티턴(specs/07 A): 턴을 **서비스와 같은 경로**로 이어 물어야
            # condense_query(맥락 유지) 회귀가 평가에 편입된다. 근거·답변은 턴별로 모아둔다.
            turns = q.get("턴") or [q["질문"]]
            hist, outs, srcs, agents = [], [], [], []
            for tq in turns:
                r = rag_answer(tq, history=hist)
                outs.append(r["content"])
                srcs += r["x_sources"]
                agents.append(r.get("x_agent"))
                hist.append((tq, r["content"]))
            content = "\n\n".join(o for o in outs if o.strip())
            if content.strip():
                # ⚠ 3키 절삭이 라우트 플래그·절단을 소실시켜 게이트 발동률·절단율이
                #   측정 불가였다(docs/69 R2, specs/16 W1-D). truthy 플래그만 보존(용량 최소).
                #   소비자(daily_grade·retrieved_expected)는 3키만 읽으므로 추가 키는 무해.
                ans = {"id": q["id"], "답변": content,
                       "x_sources": [{**{k: s.get(k) for k in ("규정명", "조", "snippet")},
                                      **{k: s[k] for k in _GATE_KEYS if s.get(k)}}
                                     for s in srcs[:8]],
                       "x_gates": r.get("x_gates"),   # 멀티턴은 마지막 턴 요약(주석 계약)
                       "소요": round(time.time() - t, 1)}
                if len(turns) > 1:
                    ans["턴답변"] = outs
                if ANSWER_MODEL != "kei-admin-rag":   # docs/74 — 경로·도구 사용 요약(분석용, 용량 최소)
                    ans["답변경로"] = ANSWER_MODEL
                    ans["에이전트"] = [{"도구": [(c.get("tool"), c.get("args")) for c in
                                               (x or {}).get("tool_calls") or []],
                                        "강등": bool((x or {}).get("fallback")), "ms": (x or {}).get("ms")}
                                       for x in agents]
                break
        except Exception as ex:  # noqa: BLE001
            print(f"  ⚠ [{q['id']}] 시도{attempt+1} {ex}", file=sys.stderr)
            ans["오류"] = str(ex)[:200]
            time.sleep(2)
    return ans


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    args = ap.parse_args()
    qf = DAILY_DIR / f"{args.date}.questions.json"
    data = json.loads(qf.read_text(encoding="utf-8"))
    out_f = DAILY_DIR / f"{args.date}.answers.json"
    done: dict = {}
    if out_f.exists():  # 중단 재개(멱등) — 단, 빈 답변(오류·중단분)은 재시도 대상이라 제외
        done = {a["id"]: a for a in json.loads(out_f.read_text(encoding="utf-8"))["answers"]
                if a.get("답변")}

    qs = data["questions"]
    got = dict(done)                   # id → 답변(완료분). 저장은 항상 **문항 순서**대로.
    lock = threading.Lock()
    t0 = time.time()

    def save(final: bool = False):
        rows = [got[q["id"]] for q in qs if q["id"] in got]
        body = {"date": args.date, "answers": rows}
        if final:
            body["답변경로"] = ANSWER_MODEL
        out_f.write_text(json.dumps(body, ensure_ascii=False, indent=1), encoding="utf-8")

    def run(q):
        a = answer_one(q)
        with lock:
            got[q["id"]] = a
            n = len(got)
            if n % 10 == 0:
                save()
                print(f"  … {n}/{len(qs)} ({round(time.time()-t0)}s, api={API}, 동시={WORKERS})")

    pending = [q for q in qs if q["id"] not in done]
    if WORKERS == 1:
        for q in pending:
            run(q)
    else:
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            list(ex.map(run, pending))
    save(final=True)
    print(f"답변 {len(got)}건 → {out_f} (총 {round(time.time()-t0)}s, 경로={ANSWER_MODEL}, 동시={WORKERS})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
