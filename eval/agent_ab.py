#!/usr/bin/env python3
"""agent_ab.py — 에이전트(omp 하네스) 답변 vs 단발 RAG 답변 A/B (docs/74).

같은 문항·같은 채점기(daily_grade)로 두 답변을 채점해 비교한다. **서비스·게시판·질문은행 무접촉**:
  · 답변: 이 프로세스가 dev API와 같은 env로 rag_core·agent_core를 직접 올리고, 도구 엔드포인트
    3개를 자체 HTTP 서버(루프백)로 띄운다 → 운영 중인 dev API를 재시작하지 않는다.
  · 채점: daily_grade.main()을 샌드박스 디렉터리에서 돌리고 save_bank를 무력화한다.
기준선(A) = 그날 게시판에 실린 단발 답변 그대로(재생성 안 함). 에이전트(B)만 새로 생성.

실행(dev worktree):
  .venv/bin/python eval/agent_ab.py --date 2026-10-06 --n-bad 14 --n-refusal 8 --n-good 18
"""
import argparse
import json
import os
import random
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def pm2_env(name: str) -> dict:
    """운영 중인 dev API와 **같은 env**(모델·컬렉션·리랭커·플래그 DB)를 그대로 쓴다 — 평가 전용 env 금지."""
    out = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, timeout=120).stdout
    for p in json.loads(out[out.index("["):]):
        if p["name"] == name:
            return {k: str(v) for k, v in (p["pm2_env"].get("env") or {}).items()
                    if k.isupper() and not k.startswith("PM2") and k not in ("PATH", "HOME", "PWD")}
    raise SystemExit(f"PM2 앱 없음: {name}")


def pick(rows: list, n_bad: int, n_ref: int, n_good: int, seed: int) -> list:
    rnd = random.Random(seed)
    bad = [r for r in rows if r["판정"] in ("오답", "부분", "검토필요") and r["유형"] != "거부형"]
    ref = [r for r in rows if r["판정"] in ("오답", "부분", "검토필요") and r["유형"] == "거부형"]
    good = [r for r in rows if r["판정"] == "정답"]
    take = lambda xs, k: rnd.sample(xs, min(k, len(xs)))  # noqa: E731
    return take(bad, n_bad) + take(ref, n_ref) + take(good, n_good)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True)
    ap.add_argument("--n-bad", type=int, default=14)
    ap.add_argument("--n-refusal", type=int, default=8)
    ap.add_argument("--n-good", type=int, default=18)
    ap.add_argument("--seed", type=int, default=1006)
    ap.add_argument("--pm2-app", default="kei-rag-api")  # 운영(3101) env — 2026-10-08 역할 교체
    ap.add_argument("--out", default=str(HERE / "reports" / "agent_ab"))
    args = ap.parse_args()

    os.environ.update(pm2_env(args.pm2_app))
    os.environ["RAG_AGENT"] = "1"
    sys.path.insert(0, str(ROOT / "tools"))
    sys.path.insert(0, str(HERE))
    os.chdir(ROOT / "tools")
    import agent_core  # noqa: E402  (env 적용 후 import — 모듈 상수가 env를 읽는다)
    import daily_grade  # noqa: E402

    daily = HERE / "daily"
    graded = json.loads((daily / f"{args.date}.graded.json").read_text(encoding="utf-8"))["문항"]
    qs_all = {q["id"]: q for q in json.loads((daily / f"{args.date}.questions.json")
                                             .read_text(encoding="utf-8"))["questions"]}
    base_ans = {a["id"]: a for a in json.loads((daily / f"{args.date}.answers.json")
                                               .read_text(encoding="utf-8"))["answers"]}
    sample = pick(graded, args.n_bad, args.n_refusal, args.n_good, args.seed)
    ids = [r["id"] for r in sample]
    out = Path(args.out) / args.date
    out.mkdir(parents=True, exist_ok=True)

    # ── 도구 서버(루프백) — agent_core 도구 백엔드를 그대로 노출 ──
    routes = {"/v1/agent/search": lambda b: agent_core.tool_search(b.get("query") or ""),
              "/v1/agent/article": lambda b: agent_core.tool_article(b.get("regulation") or "",
                                                                     b.get("article") or ""),
              "/v1/agent/toc": lambda b: agent_core.tool_toc(b.get("regulation") or ""),
              "/v1/agent/absent": lambda b: agent_core.tool_absent(b.get("question") or "",
                                                                   b.get("context") or "")}

    class H(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            if self.headers.get("X-KEI-Agent-Token") != agent_core.TOKEN or self.path not in routes:
                self.send_response(403); self.end_headers(); return
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
            data = json.dumps(routes[self.path](body), ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *a):
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]

    # ── B: 에이전트 답변 생성(중단 재개 가능) ──
    ag_f = out / "agent.answers.json"
    done = {}
    if ag_f.exists():
        done = {a["id"]: a for a in json.loads(ag_f.read_text(encoding="utf-8"))["answers"] if a.get("답변")}
    answers = []
    for i, qid in enumerate(ids):
        q = qs_all[qid]
        if qid in done:
            answers.append(done[qid]); continue
        t = time.time()
        turns = q.get("턴") or [q["질문"]]
        hist, outs, srcs, traces, fallback = [], [], [], [], False
        for tq in turns:
            r = agent_core.run_agent(tq, hist, port=port)
            if r is None:   # 서비스와 동일 — 실패면 단발로 강등(그 사실을 기록)
                import rag_core
                ctx, ss = rag_core.retrieve(rag_core.condense_query(tq, hist))
                txt = rag_core.answer(tq, ctx, hist)
                r = {"answer": txt, "srcs": ss, "trace": {"fallback": True}}
                fallback = True
            outs.append(r["answer"]); srcs += r["srcs"]; traces.append(r["trace"])
            hist += [{"role": "user", "content": tq}, {"role": "assistant", "content": r["answer"]}]
        a = {"id": qid, "답변": "\n\n".join(outs),
             "x_sources": [{k: s.get(k) for k in ("규정명", "조", "snippet")} for s in srcs[:12]],
             "x_agent": traces, "강등": fallback, "소요": round(time.time() - t, 1)}
        if len(turns) > 1:
            a["턴답변"] = outs
        answers.append(a)
        ag_f.write_text(json.dumps({"date": args.date, "answers": answers}, ensure_ascii=False, indent=1),
                        encoding="utf-8")
        calls = sum(len(tr.get("tool_calls") or []) for tr in traces)
        print(f"  [{i+1}/{len(ids)}] {qid} {a['소요']}s 도구{calls}회{' 강등' if fallback else ''}", flush=True)

    # ── 채점(샌드박스) — A: 게시판 답변 그대로, B: 에이전트 ──
    daily_grade.save_bank = lambda *_a, **_k: None   # ⛔ 질문은행 무접촉
    qset = {"questions": [qs_all[i] for i in ids]}
    res = {}
    for arm, ans in (("base", [base_ans[i] for i in ids]), ("agent", answers)):
        d = out / arm
        d.mkdir(exist_ok=True)
        (d / f"{args.date}.questions.json").write_text(json.dumps(qset, ensure_ascii=False), encoding="utf-8")
        (d / f"{args.date}.answers.json").write_text(json.dumps({"date": args.date, "answers": ans},
                                                                ensure_ascii=False), encoding="utf-8")
        daily_grade.DAILY_DIR = d
        sys.argv = ["daily_grade.py", "--date", args.date]
        daily_grade.main()
        res[arm] = {r["id"]: r for r in json.loads((d / f"{args.date}.graded.json")
                                                   .read_text(encoding="utf-8"))["문항"]}

    # ── 비교 리포트 ──
    def acc(rows):
        ok = sum(1 for r in rows if r["판정"] == "정답")
        den = sum(1 for r in rows if r["판정"] not in ("판정불가", "폐기"))
        return ok, den

    groups = {"기준선 오답(비거부)": [r["id"] for r in sample if r["판정"] != "정답" and r["유형"] != "거부형"],
              "기준선 오답(거부형)": [r["id"] for r in sample if r["판정"] != "정답" and r["유형"] == "거부형"],
              "기준선 정답": [r["id"] for r in sample if r["판정"] == "정답"]}
    lines = [f"# 에이전트 A/B — {args.date}", "",
             "| 묶음 | 문항 | 단발(A) 정답 | 에이전트(B) 정답 |", "|---|---|---|---|"]
    for g, gids in groups.items():
        a_ok, a_den = acc([res["base"][i] for i in gids])
        b_ok, b_den = acc([res["agent"][i] for i in gids])
        lines.append(f"| {g} | {len(gids)} | {a_ok}/{a_den} | {b_ok}/{b_den} |")
    a_ok, a_den = acc(list(res["base"].values()))
    b_ok, b_den = acc(list(res["agent"].values()))
    lines.append(f"| **전체** | {len(ids)} | **{a_ok}/{a_den}** | **{b_ok}/{b_den}** |")
    secs = [a["소요"] for a in answers]
    calls = [sum(len(t.get("tool_calls") or []) for t in a.get("x_agent", [])) for a in answers]
    lines += ["", f"- 에이전트 평균 소요 {sum(secs)/len(secs):.1f}s(최대 {max(secs):.0f}s) · "
              f"도구 호출 평균 {sum(calls)/len(calls):.2f}회 · 도구 1회 이상 {sum(1 for c in calls if c)}/{len(calls)}"
              f" · 강등 {sum(1 for a in answers if a.get('강등'))}건", "",
              "## 판정이 바뀐 문항", ""]
    for i in ids:
        va, vb = res["base"][i]["판정"], res["agent"][i]["판정"]
        if va != vb:
            lines.append(f"- `{i}` [{qs_all[i]['유형']}] {va} → **{vb}** — {qs_all[i]['질문'][:60]}")
    (out / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    srv.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
