#!/usr/bin/env python3
"""daily_answer.py — 일일 자가평가 ② 실서비스 답변 수집(docs/58 §2).

실서비스 동등(/v1 — 리랭커 등 서비스 구성 그대로, 평가 전용 env 금지). 문항당 독립 단발.
실행: .venv/bin/python eval/daily_answer.py [--date YYYY-MM-DD]
"""
import argparse
import datetime
import json
import sys
import time

from daily_common import API, DAILY_DIR, rag_answer


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    args = ap.parse_args()
    qf = DAILY_DIR / f"{args.date}.questions.json"
    data = json.loads(qf.read_text(encoding="utf-8"))
    out_f = DAILY_DIR / f"{args.date}.answers.json"
    done: dict = {}
    if out_f.exists():  # 중단 재개(멱등)
        done = {a["id"]: a for a in json.loads(out_f.read_text(encoding="utf-8"))["answers"]}

    answers = []
    t0 = time.time()
    for i, q in enumerate(data["questions"]):
        if q["id"] in done:
            answers.append(done[q["id"]])
            continue
        try:
            t = time.time()
            r = rag_answer(q["질문"])
            answers.append({"id": q["id"], "답변": r["content"],
                            "x_sources": [{k: s.get(k) for k in ("규정명", "조", "snippet")}
                                          for s in r["x_sources"][:8]],
                            "소요": round(time.time() - t, 1)})
        except Exception as ex:  # noqa: BLE001
            print(f"  ⚠ [{q['id']}] {ex}", file=sys.stderr)
            answers.append({"id": q["id"], "답변": "", "x_sources": [], "오류": str(ex)[:200]})
        if (i + 1) % 10 == 0:
            out_f.write_text(json.dumps({"date": args.date, "answers": answers},
                                        ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"  … {i+1}/{len(data['questions'])} ({round(time.time()-t0)}s, api={API})")
    out_f.write_text(json.dumps({"date": args.date, "answers": answers}, ensure_ascii=False, indent=1),
                     encoding="utf-8")
    print(f"답변 {len(answers)}건 → {out_f} (총 {round(time.time()-t0)}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
