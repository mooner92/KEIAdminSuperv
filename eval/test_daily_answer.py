#!/usr/bin/env python3
"""test_daily_answer.py — 답변 수집(daily_answer) 계약: 순서 보존·중단 재개·동시 실행 동치·경로 기록(docs/74).

서버·모델 없이 rag_answer를 대역으로 바꿔 돈다.
실행: ../tools/.venv/bin/python test_daily_answer.py
"""
import json
import random
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import daily_answer  # noqa: E402

QS = [{"id": f"q{i}", "질문": f"질문{i}"} for i in range(13)] + [{"id": "s1", "질문": "x", "턴": ["턴1", "턴2"]}]


def fake(q, history=None):
    time.sleep(random.random() * 0.01)   # 완료 순서를 섞는다(동시 실행에서 순서 보존 확인용)
    return {"content": f"답:{q}:{len(history or [])}", "x_sources": [{"규정명": "R", "조": "제1조"}],
            "x_gates": {}, "x_agent": {"tool_calls": [{"tool": "search_regs", "args": {"query": q}}]}}


def run(workers: int, pre: list | None = None) -> dict:
    d = Path(tempfile.mkdtemp())
    (d / "2099-01-01.questions.json").write_text(json.dumps({"questions": QS}, ensure_ascii=False), encoding="utf-8")
    if pre is not None:
        (d / "2099-01-01.answers.json").write_text(json.dumps({"answers": pre}, ensure_ascii=False), encoding="utf-8")
    daily_answer.DAILY_DIR, daily_answer.rag_answer, daily_answer.WORKERS = d, fake, workers
    sys.argv = ["daily_answer.py", "--date", "2099-01-01"]
    daily_answer.main()
    return json.loads((d / "2099-01-01.answers.json").read_text(encoding="utf-8"))


def test_order_preserved_with_workers():
    out = run(4)
    assert [a["id"] for a in out["answers"]] == [q["id"] for q in QS]


def test_sequential_equals_parallel():
    strip = lambda o: [{k: v for k, v in a.items() if k != "소요"} for a in o["answers"]]  # noqa: E731
    assert strip(run(1)) == strip(run(3))


def test_multiturn_history_carried():
    a = next(x for x in run(2)["answers"] if x["id"] == "s1")
    assert a["턴답변"] == ["답:턴1:0", "답:턴2:1"]


def test_resume_keeps_done_and_retries_empty():
    pre = [{"id": "q0", "답변": "이전 답"}, {"id": "q1", "답변": ""}]
    out = {a["id"]: a for a in run(2, pre)["answers"]}
    assert out["q0"]["답변"] == "이전 답" and out["q1"]["답변"].startswith("답:")


def test_path_recorded_for_agent():
    old = daily_answer.ANSWER_MODEL
    try:
        daily_answer.ANSWER_MODEL = "kei-agent"
        out = run(2)
        assert out["답변경로"] == "kei-agent"
        a = out["answers"][0]
        assert a["답변경로"] == "kei-agent" and a["에이전트"][0]["도구"][0][0] == "search_regs"
    finally:
        daily_answer.ANSWER_MODEL = old


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"  ok  {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  ❌  {fn.__name__}: {e}")
    if failed:
        sys.exit(1)
    print(f"\n✅ {len(fns)}개 통과 — 답변 수집 계약(순서·재개·동시·경로)")
