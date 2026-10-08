#!/usr/bin/env python3
"""test_agent_core.py — 에이전트 답변 경로(docs/74) 순수 로직 유닛. 모델·Chroma·bun 미로딩.

지키는 것:
  · 가드레일 불변(절대 규칙 4) — 에이전트 system은 rag_core.SYSTEM을 **그대로** 포함(덧붙이기만).
  · 근거 0건 답변 거부(절대 규칙 1) — 도구/시드 근거 없이 쓴 답은 None(단발 강등).
  · 인용 힌트 실측 결함(2026-10-06) — 가이드 블록 속 '제9조'를 그 가이드의 조로 귀속해
    모델이 '[계산 가이드 제9조]' 가짜 출처를 썼다 → 규정 블록·자기 규정 인용만 힌트.
  · 가짜 링크 백스톱 — omp가 주입한 작업 경로를 9B가 URL로 지어냈다(실측).
  · 외부망 2중 차단 — 하위 프로세스 env의 프록시는 죽은 주소, 루프백만 예외.

실행: .venv/bin/python tools/test_agent_core.py
"""
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agent_core  # noqa: E402
import rag_core  # noqa: E402

REG = {"규정명": "여비규정", "조": "제16조", "type": "regulation", "tag": "여비규정 제16조"}
GUIDE = {"규정명": "국내출장 여비 — 얼마 나오나 (계산 가이드)", "조": "5. 정산", "type": "guide",
         "tag": "국내출장 여비 — 얼마 나오나 (계산 가이드) 5. 정산"}


def test_system_prompt_keeps_guardrail_verbatim():
    sp = agent_core.system_prompt()
    assert sp.endswith(rag_core.SYSTEM), "SYSTEM 본문이 그대로 끝에 있어야 한다(약화·변형 금지)"
    assert "규정에서 확인되지 않습니다" in sp


def test_hint_regulation_block_cites_missing_byeolpyo():
    ctx = "[여비규정 제16조]\n제16조(숙박비) 숙박비는 별표 2에 따른다."
    assert "여비규정 별표 2" in agent_core.citation_hint(ctx, [REG])


def test_hint_skips_guide_block_refs():  # 실측 결함: '[계산 가이드 제9조]' 가짜 출처
    ctx = "[국내출장 여비 — 얼마 나오나 (계산 가이드) 5. 정산]\n여행을 마친 다음 날부터 7일 이내(제9조)."
    assert agent_core.citation_hint(ctx, [GUIDE]) == ""


def test_hint_skips_other_law_refs():
    ctx = "[여비규정 제16조]\n「공무원 여비 규정」 제9조를 준용하고, 법 제3조에 따른다."
    assert agent_core.citation_hint(ctx, [REG]) == ""


def test_hint_skips_already_present():
    ctx = "[여비규정 제16조]\n별표 2에 따른다.\n\n---\n\n[여비규정 별표 2]\n…"
    srcs = [REG, {**REG, "조": "별표 2", "tag": "여비규정 별표 2"}]
    assert agent_core.citation_hint(ctx, srcs) == ""


def test_strip_fake_link_keeps_label():
    out = agent_core.strip_unsourced_links("[여비규정 별표 2](https://kei.co.kr/kei-dev-0703/tools/agent) 참조", "근거")
    assert out == "여비규정 별표 2 참조", out


def test_keep_link_present_in_context():
    url = "https://www.law.go.kr/법령/근로기준법"
    out = agent_core.strip_unsourced_links(f"[근로기준법]({url})", f"원문: {url}")
    assert url in out


def test_jo_norm_variants():
    n = agent_core._jo_norm
    assert n("18") == n("제18조") == n("18조") == n("제 18 조")
    assert n("별표2") == n("별표 2") == n("[별표 2]")
    assert n("제4조의2 ①") == n("제4조의2") != n("제4조")


def test_wants_requires_enabled():
    old = agent_core.ENABLED
    try:
        agent_core.ENABLED = False
        assert not agent_core.wants("kei-agent")
        agent_core.ENABLED = True
        assert agent_core.wants("kei-agent") and not agent_core.wants("kei-admin-rag")
    finally:
        agent_core.ENABLED = old


def test_env_blocks_external_proxy():
    env = agent_core._env()
    assert env["HTTPS_PROXY"].startswith("http://127.0.0.1:") and "127.0.0.1" in env["NO_PROXY"]
    assert env["PI_CODING_AGENT_DIR"].endswith(".omp-home")


def _run_with(out_json: dict):
    """run_agent를 모델·검색·bun 없이 돌린다(러너 결과만 주입)."""
    saved = (agent_core._bun, agent_core._spawn, rag_core.condense_query, rag_core.retrieve,
             rag_core.post_answer_notes)
    try:
        agent_core._bun = lambda: "/bin/true"
        agent_core._spawn = lambda bun, payload, on_progress=None: out_json
        rag_core.condense_query = lambda q, h=None: q
        rag_core.retrieve = lambda q: ("", [])
        rag_core.post_answer_notes = lambda *a, **k: ""
        return agent_core.run_agent("질문", [])
    finally:
        (agent_core._bun, agent_core._spawn, rag_core.condense_query, rag_core.retrieve,
         rag_core.post_answer_notes) = saved


class _FakeProc:
    """Popen 대역 — 러너 stdout NDJSON을 줄 단위로 흘린다."""
    def __init__(self, lines):
        self.stdin = io.StringIO()
        self.stdin.close = lambda: None
        self.stdout = iter(lines)
        self.returncode = 0

    def wait(self):
        return 0

    def kill(self):
        pass


def test_spawn_streams_progress_then_result():
    lines = ['{"type":"progress","stage":"seed","n":5,"ms":10}\n', "omp 로그 한 줄\n",
             '{"type":"progress","stage":"tool","tool":"search_regs","args":{"query":"숙박비"},"ms":20}\n',
             '{"type":"result","answer":"답","evidence":[],"toolCalls":[]}\n']
    got = []
    saved = agent_core.subprocess.Popen
    try:
        agent_core.subprocess.Popen = lambda *a, **k: _FakeProc(lines)
        out = agent_core._spawn("/bin/true", {"q": 1}, on_progress=got.append)
    finally:
        agent_core.subprocess.Popen = saved
    assert [e["stage"] for e in got] == ["seed", "tool"] and got[1]["args"]["query"] == "숙박비"
    assert out["answer"] == "답"


def test_progress_callback_error_does_not_break():
    lines = ['{"type":"progress","stage":"check"}\n', '{"type":"result","answer":"답"}\n']
    saved = agent_core.subprocess.Popen
    try:
        agent_core.subprocess.Popen = lambda *a, **k: _FakeProc(lines)
        out = agent_core._spawn("/bin/true", {}, on_progress=lambda e: 1 / 0)
    finally:
        agent_core.subprocess.Popen = saved
    assert out["answer"] == "답"


def test_verify_prompt_only_adds():   # 검증 턴은 SYSTEM 재확인 — 완화 문구가 없어야 한다
    vp = agent_core.VERIFY_PROMPT
    assert "규정에서 확인되지 않습니다" in vp and "지어" not in vp.replace("지어내지", "")


def test_zero_evidence_answer_rejected():  # 절대 규칙 1 — 근거 없이 쓴 답은 받지 않는다
    assert _run_with({"answer": "**5만원입니다.**", "evidence": [], "toolCalls": []}) is None


def test_error_or_empty_rejected():
    ev = [{"tool": "seed", "context": "[여비규정 제16조]\n…", "sources": [REG]}]
    assert _run_with({"answer": "", "evidence": ev, "toolCalls": []}) is None
    assert _run_with({"answer": "x", "evidence": ev, "toolCalls": [], "error": "boom"}) is None


def test_success_postprocessed():
    ev = [{"tool": "seed", "context": "[여비규정 제16조]\n숙박비는 별표 2에 따른다.", "sources": [REG]},
          {"tool": "read_article", "context": "[여비규정 별표 2 · 조문 전문]\n…",
           "sources": [{**REG, "조": "별표 2", "tag": "여비규정 별표 2"}]}]
    r = _run_with({"answer": "**별표 2를 따릅니다.** [링크](https://evil.example/x)", "evidence": ev,
                   "toolCalls": [{"tool": "read_article"}], "checkNote": "점검 완료",
                   "draft": "**초안**", "absent": ["명상실(규정 전체에 없음)"]})
    assert r is not None
    assert "https://evil.example" not in r["answer"]
    assert rag_core.DISCLAIMER in r["answer"]
    assert [s["조"] for s in r["srcs"]] == ["제16조", "별표 2"]
    assert r["trace"]["check"] == "점검 완료"
    assert r["trace"]["verified"] and r["trace"]["revised"] and r["trace"]["absent"]


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
    print(f"\n✅ {len(fns)}개 테스트 통과 — 에이전트 답변 경로(docs/74)")
