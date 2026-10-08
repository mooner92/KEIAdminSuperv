#!/usr/bin/env python3
"""test_agent_chat.py — 채팅 에이전트 스트림(docs/74 §7) 계약. 모델·bun·실 app.db 미접촉.

지키는 것:
  · 순서: progress(여러 번) → meta → delta… → done — 기존 화면 프로토콜(meta→delta→done) 불변
  · 강등: 에이전트 실패면 같은 스트림 안에서 기존 경로로 이어 답한다(빈 답 없음)
  · 저장 보장: 사용자가 진행 중에 떠나도(제너레이터 close) 답은 끝까지 만들어 **정확히 한 번** 저장
  · 플래그 off·에이전트 env off면 기존 경로 그대로

실행: .venv/bin/python tools/test_agent_chat.py
"""
import json
import os
import sys
import tempfile
import threading
import time
import types
from pathlib import Path

os.environ["APP_DB"] = os.path.join(tempfile.mkdtemp(), "agent-chat-test.db")   # 실제 app.db 미접촉
sys.path.insert(0, str(Path(__file__).resolve().parent))
import agent_core  # noqa: E402
import app_api  # noqa: E402
import rag_core  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

SRC = {"규정명": "여비규정", "조": "제16조", "type": "regulation", "tag": "여비규정 제16조"}


def _setup():
    with Session(app_api.engine) as s:
        u = app_api.User(username=f"t{time.time_ns()}@kei.re.kr", password_hash="x", verified=True)
        s.add(u)
        s.commit()
        s.refresh(u)
        cs = app_api.ChatSession(user_id=u.id)
        s.add(cs)
        s.commit()
        s.refresh(cs)
        s.refresh(u)
        s.expunge(u)     # 세션 밖에서 쓸 사용자 객체(커밋 만료 해제)
        return u, cs.id


def _stub_common(flag_on=True):
    rag_core.condense_query = lambda q, h=None: q
    rag_core.retrieve = lambda q: ("[여비규정 제16조]\n숙박비는 별표 2에 따른다.", [SRC])
    rag_core._flag = lambda name, default=False: flag_on if name == "agent_chat" else default
    rag_core.suggest_followups = lambda q, s: []
    rag_core.gate_summary = lambda a, c, s: {}
    rag_core.post_answer_notes = lambda *a, **k: ""
    rag_core.is_refusal = lambda t: False
    rag_core.answer_stream = lambda q, c, h=None, **k: iter(["기존 ", "경로 답"])
    agent_core.ENABLED = True
    app_api.StreamingResponse = lambda gen, **kw: gen   # 원 제너레이터를 그대로 받는다


def _post(cid, user):
    req = types.SimpleNamespace(scope={"server": ("127.0.0.1", 9001)})
    return app_api.post_message(cid, app_api.MsgIn(content="숙박비 얼마?"), req, stream=True, user=user)


def _events(chunks):
    out = []
    for c in chunks:
        if c.startswith("data: "):
            out.append(json.loads(c[6:]))
    return out


def _assistants(cid):
    with Session(app_api.engine) as s:
        return [m for m in s.exec(select(app_api.Message).where(app_api.Message.session_id == cid)).all()
                if m.role == "assistant"]


def test_order_progress_meta_delta_done():
    _stub_common()

    def fake_run(q, h, port=9000, on_progress=None, seed=None):
        assert seed is not None and port == 9001       # 채팅 경로의 1차 검색 재사용·자기 포트 콜백
        on_progress({"type": "progress", "stage": "seed", "n": 1})
        on_progress({"type": "progress", "stage": "tool", "tool": "read_article",
                     "args": {"regulation": "여비규정", "article": "별표 2"}})
        return {"answer": "**별표 2에 따릅니다.**", "context": seed[0], "srcs": [SRC],
                "trace": {"ms": 1, "verified": True, "revised": False, "nudged": False}}
    agent_core.run_agent = fake_run
    u, cid = _setup()
    ev = _events(list(_post(cid, u)))
    kinds = [e["type"] for e in ev]
    assert kinds[0] == "progress" and kinds.index("meta") > max(i for i, k in enumerate(kinds) if k == "progress")
    assert kinds[-1] == "done" and "delta" in kinds
    labels = [e["label"] for e in ev if e["type"] == "progress"]
    assert any("여비규정 별표 2 원문을 읽는 중" in l for l in labels), labels
    assert "".join(e["t"] for e in ev if e["type"] == "delta") == "**별표 2에 따릅니다.**"
    assert [m.content for m in _assistants(cid)] == ["**별표 2에 따릅니다.**"]


def test_fallback_to_single_shot_in_same_stream():
    _stub_common()
    agent_core.run_agent = lambda *a, **k: None
    u, cid = _setup()
    ev = _events(list(_post(cid, u)))
    assert any(e.get("stage") == "fallback" for e in ev)
    assert ev[-1]["type"] == "done"
    assert [m.content for m in _assistants(cid)] == ["기존 경로 답"]


def test_abandon_mid_progress_still_saves_once():
    _stub_common()
    release = threading.Event()

    def slow_run(q, h, port=9000, on_progress=None, seed=None):
        on_progress({"type": "progress", "stage": "check"})
        release.wait(5)
        return {"answer": "늦게 끝난 답", "context": "", "srcs": [SRC], "trace": {}}
    agent_core.run_agent = slow_run
    u, cid = _setup()
    g = _post(cid, u)
    next(g)          # 'start' progress
    next(g)          # 'check' progress
    g.close()        # 사용자가 떠남(GeneratorExit)
    release.set()
    for _ in range(50):
        if _assistants(cid):
            break
        time.sleep(0.05)
    time.sleep(0.2)  # 중복 저장이 있다면 이 사이에 생긴다
    assert [m.content for m in _assistants(cid)] == ["늦게 끝난 답"]


def test_flag_off_uses_existing_path():
    _stub_common(flag_on=False)
    agent_core.run_agent = lambda *a, **k: (_ for _ in ()).throw(AssertionError("에이전트가 불리면 안 됨"))
    u, cid = _setup()
    ev = _events(list(_post(cid, u)))
    assert not any(e["type"] == "progress" for e in ev) and ev[-1]["type"] == "done"


def test_labels_cover_all_stages():
    for ev in ({"stage": "seed", "n": 3}, {"stage": "check"}, {"stage": "answer"}, {"stage": "verify"},
               {"stage": "tool", "tool": "search_regs", "args": {"query": "가" * 80}},
               {"stage": "tool", "tool": "list_articles", "args": {"regulation": "복무규정"}}):
        lab = agent_core.progress_label(ev)["label"]
        assert lab and len(lab) < 80 and "처리하는 중" not in lab, (ev, lab)


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
    print(f"\n✅ {len(fns)}개 테스트 통과 — 채팅 에이전트 스트림(docs/74 §7)")
