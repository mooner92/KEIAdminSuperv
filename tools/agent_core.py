"""agent_core.py — 에이전트 답변 경로: oh-my-pi(omp) 하네스 + 로컬 Qwen + 읽기 전용 규정 도구.

왜(2026-10-06 운영자 요구): 단발 RAG(검색 1회→생성 1회)는 첫 검색이 빗나가거나 조문이 잘리면
복구할 수단이 없다. 에이전트는 ① 검색어를 문서 용어로 바꿔 재검색 ② 잘린 조문·인용된 별표를
전문으로 열람 ③ 목차로 위치를 찾은 뒤 답한다. 모델·근거·가드레일은 서비스와 **동일**하다.

구성:
  · 도구 백엔드(tool_search/tool_article/tool_toc) — 04_rag_api가 `/v1/agent/*`로 노출.
    검색은 rag_core.retrieve 그대로(리랭커·별표·정의어·적용범위 자동첨부 포함), 열람·목차는 Chroma 직조회.
    ⛔ 읽기 전용. 표 손상·삭제 조문 오버레이를 retrieve와 똑같이 씌운다(신뢰 게이트 P0 유지).
  · run_agent() — tools/agent/kei_agent.ts(bun)를 띄워 답을 받고, 서비스와 같은 후처리
    (_postprocess·집계 단서·면책·수치/귀속/주제 게이트)를 **에이전트가 실제로 읽은 근거** 기준으로 적용.

⛔ 가드레일(절대 규칙 4): rag_core.SYSTEM 본문은 불변 — 앞에 도구 사용 절차를 **덧붙이기만** 한다.
⛔ 실패(타임아웃·빈 답·도구 0회)면 None → 호출자가 기존 단발 경로로 강등(답변 공백 없음).
⛔ 외부망 0: omp 카탈로그 갱신은 offline, 프록시 env를 죽은 주소로 고정(NO_PROXY=루프백) — 2중 차단.
"""
from __future__ import annotations

import difflib
import json
import os
import re
import secrets
import shutil
import subprocess
import threading
from pathlib import Path

import rag_core

HERE = Path(__file__).resolve().parent
AGENT_DIR = HERE / "agent"
OMP_HOME = AGENT_DIR / ".omp-home"          # gitignore — omp 설정/캐시 격리(사용자 ~/.omp와 분리)

ENABLED = os.environ.get("RAG_AGENT", "0") == "1"
MODEL_ID = os.environ.get("RAG_AGENT_MODEL_ID", "kei-agent")        # 요청 model 필드로 선택
LLM = os.environ.get("RAG_AGENT_LLM", "kei-qwen35-agent:latest")    # 같은 GGUF·num_ctx 32K 별칭
# 에이전트 전용 Ollama(11437) — 서비스 Ollama(11436)는 러너 1개만 상주해 32K 별칭을 올리면 서비스 러너가
# 축출된다(실측: 다음 서비스 답변 106초). 미설정이면 서비스와 같은 베이스(실험용).
LLM_BASE = os.environ.get("RAG_AGENT_LLM_BASE", "") or rag_core.VLLM_BASE
CTX = int(os.environ.get("RAG_AGENT_CTX", "32768"))
MAX_TOOLS = int(os.environ.get("RAG_AGENT_MAX_TOOLS", "3"))
TIMEOUT = int(os.environ.get("RAG_AGENT_TIMEOUT", "300"))
# 도구 검색 결과 1회 상한(문자) — 시드는 서비스와 같은 6,000자, 보충 검색은 짧게(실측: 6,000자씩
# 4회 쌓이자 Vulkan prefill이 병목이 돼 2턴 시나리오 1문항이 450초).
TOOL_CHARS = int(os.environ.get("RAG_AGENT_TOOL_CHARS", "3500"))
API_BASE = os.environ.get("RAG_AGENT_API", "http://127.0.0.1:{port}")
TOKEN = secrets.token_hex(16)   # 도구 엔드포인트 인증 — 이 프로세스가 띄운 에이전트만 안다
_SEM = threading.Semaphore(int(os.environ.get("RAG_AGENT_CONCURRENCY", "2")))


def wants(model: str | None) -> bool:
    return ENABLED and (model or "").strip() == MODEL_ID


def _bun() -> str | None:
    cand = [os.environ.get("RAG_AGENT_BUN"), shutil.which("bun"),
            os.path.expanduser("~/.bun/bin/bun")]
    nvm = Path.home() / ".nvm/versions/node"
    if nvm.is_dir():
        cand += [str(p / "bin/bun") for p in sorted(nvm.iterdir(), reverse=True)]
    return next((c for c in cand if c and os.path.isfile(c) and os.access(c, os.X_OK)), None)


PREAMBLE = (
    "너는 KEI 행정 도우미 **에이전트**다. 사용자 메시지의 [근거]에는 1차 검색 결과가 이미 들어 있고,"
    " 다음 도구로 근거를 보충할 수 있다:\n"
    "· search_regs(query) — 규정·가이드·시스템 매뉴얼 의미 검색. 질문의 일상어를 규정 문서 용어로 바꿔 쓴다.\n"
    "· read_article(regulation, article) — 조문·별표 전문 열람. [근거]가 다른 조나 '별표 N'을 인용만 하고"
    " 본문이 없을 때, 금액·한도·일수를 별표 원문에서 확인할 때 쓴다.\n"
    "· list_articles(regulation) — 규정 목차. 어느 조를 열지 모를 때 쓴다.\n"
    f"도구는 최대 {MAX_TOOLS}회. 작업은 두 단계다: 먼저 [점검](근거 유무 표시 + 빈 곳만 도구로 보충),"
    " 그다음 [최종 답변].\n"
    "아래 규칙에서 [근거]란 **1차 검색 결과와 이번 대화에서 도구가 돌려준 결과 전체**를 말한다."
    " 그 밖의 내용은 [근거]에 없는 것이다.\n\n"
)

CHECK_PROMPT = (
    "[1단계 — 점검] 아직 답변을 쓰지 마라. 질문이 요구하는 항목(값·기한·조건·절차 등)을 하나씩 적고,"
    " 각 항목이 [근거] 본문에 직접 있으면 '있음 [규정명 조]', 없으면 '없음'으로 표시하라."
    " '없음'이거나 [근거]가 별표·다른 조를 인용만 한 항목은 지금 도구로 찾아라"
    " ([추가 확인 후보]의 조문은 read_article로 바로 열 수 있다). 도구 결과를 받으면 표시를 갱신하라."
    " 모든 항목이 '있음'이 되었거나 더 찾을 곳이 없으면 '점검 완료'라고 써라."
)
FINAL_PROMPT = (
    "[2단계 — 최종 답변] 지금까지의 [근거](1차 검색 결과 + 도구 결과)만으로 시스템 규칙에 맞춰 최종 답변을 작성하라."
    " 점검 표·도구 이름·검색 과정·링크(URL)는 쓰지 마라. 끝까지 '없음'인 항목은 '규정에서 확인되지 않습니다'로 답한다."
)


def system_prompt() -> str:
    """에이전트 system = 도구 절차(추가) + 서비스 SYSTEM(불변). 강화만, 약화 없음."""
    return PREAMBLE + rag_core.SYSTEM


# ── 도구 백엔드 ──────────────────────────────────────────────────────────────
_meta: dict = {}
_meta_lock = threading.Lock()
SEP = "\n\n---\n\n"   # rag_core 근거 블록 구분자


def _norm(s: str) -> str:
    return re.sub(r"[\s「」『』\[\]()（）·･ㆍ_-]", "", s or "")


def _names() -> list:
    if "names" not in _meta:
        with _meta_lock:
            if "names" not in _meta:
                _, col, _ = rag_core.backend()
                metas = col.get(include=["metadatas"])["metadatas"]
                _meta["names"] = sorted({(m.get("규정명") or "").strip() for m in metas} - {""})
    return _meta["names"]


def resolve_name(q: str) -> tuple[str | None, list]:
    """규정명 관대 매칭: 정확 → 정규화 일치 → 포함 관계(길이차 최소) → 실패 시 유사 후보."""
    names = _names()
    q = (q or "").strip()
    if q in names:
        return q, []
    nq = _norm(q)
    exact = [n for n in names if _norm(n) == nq]
    if exact:
        return exact[0], []
    contain = [n for n in names if nq and (nq in _norm(n) or _norm(n) in nq)]
    if contain:
        return min(contain, key=lambda n: abs(len(_norm(n)) - len(nq))), []
    return None, difflib.get_close_matches(q, names, n=5, cutoff=0.3)


def _jo_norm(s: str) -> str:
    s = (s or "").strip().strip("[]")
    if re.fullmatch(r"\d+(?:의\d+)?", s.replace(" ", "")):
        s = f"제{s.replace(' ', '')}조"
    s = re.sub(r"^(\d+)조", r"제\1조", s.replace(" ", ""))
    return _norm(rag_core._jo_key(s) if s.startswith("제") else s)


def _chunks_of(name: str) -> list:
    _, col, _ = rag_core.backend()
    got = col.get(where={"규정명": name}, include=["documents", "metadatas"])

    def order(i):
        m = re.search(r"#(\d+)$", i)
        return int(m.group(1)) if m else 0
    return sorted(zip(got["ids"], got["documents"], got["metadatas"]), key=lambda t: order(t[0]))


def _finish(srcs: list, blocks: list) -> dict:
    """retrieve와 같은 신뢰 오버레이(삭제 조문 경고·표 손상 라벨) 후 근거 텍스트로."""
    if srcs:
        rag_core._overlay_article_status(srcs, blocks)
        rag_core._overlay_table_integrity(srcs, blocks)
    return {"text": "\n\n---\n\n".join(blocks), "sources": srcs}


def tool_search(query: str) -> dict:
    query = (query or "").strip()
    if not query:
        return {"text": "검색어가 비어 있습니다.", "sources": []}
    context, srcs = rag_core.retrieve(query)
    blocks = [b for b in (context or "").split(SEP) if b.strip()]
    kept, used = [], 0
    for b in blocks:   # 순위순 — 블록 단위로 예산 안에서(첫 블록이 넘치면 그 블록만 잘라 싣는다)
        if used + len(b) > TOOL_CHARS:
            if not kept:
                kept.append(b[:TOOL_CHARS].rstrip() + "\n…(일부 — 전문은 read_article)")
            break
        kept.append(b); used += len(b)
    srcs = srcs[: len(kept)] if len(srcs) == len(blocks) else \
        [s for s in srcs if any(str(s.get("tag") or "\0") in k.split("\n", 1)[0] for k in kept)]
    return {"text": SEP.join(kept) or "(검색 결과 없음)", "sources": srcs}


def tool_article(regulation: str, article: str) -> dict:
    name, near = resolve_name(regulation)
    if not name:
        return {"text": f"규정명 '{regulation}'을(를) 찾지 못했습니다."
                        + (f" 비슷한 이름: {', '.join(near)}" if near else ""), "sources": []}
    want = _jo_norm(article)
    hits = [(i, d, m) for i, d, m in _chunks_of(name)
            if _jo_norm(m.get("조") or "") == want]
    if not hits:
        return {"text": f"[{name}]에서 '{article}'을(를) 찾지 못했습니다. list_articles로 목차를 확인하세요.",
                "sources": []}
    m0 = hits[0][2]
    body = "\n".join(d for _, d, _ in hits)
    if len(body) > rag_core.CTX_MAX_CHARS:     # 초장문 별표 — 컨텍스트 상한 존중(절단 표시)
        body = body[: rag_core.CTX_MAX_CHARS] + "\n…(이하 생략 — 원문 확인 필요)"
    src = rag_core._src(body, m0, None)
    label = f"[{src['tag']} · 조문 전문]"
    return _finish([src], [f"{label}\n{body}"])


def tool_toc(regulation: str) -> dict:
    name, near = resolve_name(regulation)
    if not name:
        return {"text": f"규정명 '{regulation}'을(를) 찾지 못했습니다."
                        + (f" 비슷한 이름: {', '.join(near)}" if near else ""), "sources": []}
    seen, lines = set(), []
    for _, d, m in _chunks_of(name):
        jo = (m.get("조") or "").strip()
        if not jo or jo in seen:
            continue
        seen.add(jo)
        first = next((ln.strip() for ln in d.splitlines() if ln.strip()), "")
        lines.append(f"- {jo}: {first[:60]}")
    text = f"[{name} 목차] (조 {len(lines)}개)\n" + "\n".join(lines[:150])
    return {"text": text, "sources": []}


# ── 에이전트 실행 ────────────────────────────────────────────────────────────
_REF_RE = re.compile(r"(별표\s*\d+(?:의\d+)?|제\d+조(?:의\d+)?)")
_HEAD_RE = re.compile(r"^\[([^\]]+)\]")
_FOREIGN_REF = re.compile(r"(」|법|령|규정|규칙|지침|요령|기준)\s*$")


def citation_hint(context: str, srcs: list, limit: int = 4) -> str:
    """1차 근거의 **규정 블록** 본문이 인용하지만 근거에 없는 같은 규정의 조·별표 → 열람 후보(결정적, LLM 0회).

    9B는 '별표 2에 따른다'를 읽고도 별표를 열지 않고 금액을 지어내거나 거부한다(실측). 후보를 명시해
    read_article 한 번이면 닿게 한다. ⛔ 후보는 힌트일 뿐 근거가 아니다 — 열람 결과만 [근거]가 된다.
    ⚠ 실측 결함(2026-10-06): 가이드 블록 속 '제9조'(실은 여비규정 조문)를 그 가이드의 조로 귀속해
      모델이 '[계산 가이드 제9조]'라는 가짜 출처를 썼다 → 규정(regulation) 블록만, 그리고 앞에
      「…」·법·령·규정·규칙명이 붙은 인용(타 법령)은 제외한다.
    """
    have = {(s.get("규정명"), _jo_norm(s.get("조") or "")) for s in srcs}
    regs = {s.get("규정명") for s in srcs if s.get("규정명") and (s.get("type") or "") == "regulation"}
    out = []
    for block in (context or "").split("\n\n---\n\n"):
        head = _HEAD_RE.match(block.strip())
        if not head:
            continue
        name = next((n for n in sorted(regs, key=len, reverse=True) if head.group(1).startswith(n)), None)
        if not name:
            continue
        body = block.split("\n", 1)[1] if "\n" in block else ""
        for m in _REF_RE.finditer(body):
            if _FOREIGN_REF.search(body[max(0, m.start() - 6): m.start()]):
                continue   # 「여비규정」 제9조·법 제3조 — 다른 법령의 조문
            ref = re.sub(r"\s+", " ", m.group(1))
            key = (name, _jo_norm(ref))
            if key in have or key in {(n, _jo_norm(r)) for n, r in out}:
                continue
            out.append((name, ref))
            if len(out) >= limit:
                break
    return "\n".join(f"- {n} {r}" for n, r in out)


_MD_LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")
_BARE_URL = re.compile(r"https?://[^\s)\]]+")


def strip_unsourced_links(answer: str, context: str) -> str:
    """근거에 없는 URL 제거(값 불변) — 실측: omp가 주입한 작업 경로를 9B가 가짜 링크로 만들어 냈다."""
    ans = _MD_LINK.sub(lambda m: m.group(0) if m.group(2) in context else m.group(1), answer or "")
    return _BARE_URL.sub(lambda m: m.group(0) if m.group(0) in context else "", ans)


def _dedup(srcs: list) -> list:
    out, seen = [], set()
    for s in srcs:
        k = (s.get("규정명"), s.get("조"))
        if k in seen:
            continue
        seen.add(k)
        out.append(s)
    return out


def _env() -> dict:
    env = {k: v for k, v in os.environ.items() if not k.lower().endswith("_proxy")}
    env.update({
        "PI_CODING_AGENT_DIR": str(OMP_HOME),
        "PI_NO_TITLE": "1", "PI_NO_EMBEDDINGS": "1",
        # 외부망 2중 차단: 혹시 omp가 외부 fetch를 시도해도 죽은 프록시로 빠진다(루프백만 예외).
        "HTTP_PROXY": "http://127.0.0.1:9", "HTTPS_PROXY": "http://127.0.0.1:9",
        "http_proxy": "http://127.0.0.1:9", "https_proxy": "http://127.0.0.1:9",
        "NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost",
    })
    return env


def run_agent(question: str, history=None, port: int = 9000) -> dict | None:
    """에이전트로 답변. 성공 시 {answer, context, srcs, trace}, 실패 시 None(호출자가 강등)."""
    bun = _bun()
    if not bun:
        print("[agent] ⚠ bun 미발견 — 단발 경로로 강등")
        return None
    hist = [{"role": h.get("role"), "content": h.get("content")}
            for h in (history or []) if h.get("role") in ("user", "assistant") and h.get("content")]
    # 1차 근거 = 서비스 단발 경로와 같은 검색(멀티턴은 condense_query로 독립 검색어) — 기준선 이상 보장
    q_search = rag_core.condense_query(question, hist)
    context0, srcs0 = rag_core.retrieve(q_search)
    payload = {
        "seed": {"context": context0, "sources": srcs0, "hint": citation_hint(context0, srcs0)},
        "temperature": 0.1,
        "checkPrompt": CHECK_PROMPT, "finalPrompt": FINAL_PROMPT,
        "question": question, "history": hist, "system": system_prompt(),
        "api": API_BASE.format(port=port), "token": TOKEN,
        "model": {"baseUrl": LLM_BASE, "id": LLM, "contextWindow": CTX, "maxTokens": 2048},
        "maxToolCalls": MAX_TOOLS, "agentDir": str(OMP_HOME),
    }
    with _SEM:   # GPU·Ollama 보호 — 동시 에이전트 수 상한
        try:
            p = subprocess.run([bun, str(AGENT_DIR / "kei_agent.ts")], input=json.dumps(payload),
                               capture_output=True, text=True, timeout=TIMEOUT,
                               cwd=str(AGENT_DIR), env=_env())
        except subprocess.TimeoutExpired:
            print(f"[agent] ⚠ 시간 초과({TIMEOUT}s) — 단발 경로로 강등")
            return None
    line = next((ln for ln in reversed((p.stdout or "").splitlines()) if ln.startswith("{")), "")
    try:
        out = json.loads(line)
    except ValueError:
        print(f"[agent] ⚠ 출력 파싱 실패 rc={p.returncode} err={(p.stderr or '')[-300:]}")
        return None
    trace = {"tool_calls": out.get("toolCalls", []), "ms": out.get("ms"), "llm": LLM}
    if out.get("error"):
        print(f"[agent] ⚠ {out['error'][:300]}")
        return None
    evidence = [e for e in out.get("evidence", []) if (e.get("context") or "").strip()]
    raw = (out.get("answer") or "").strip()
    # ⛔ 근거 0건 답변은 받지 않는다 — 근거 없이 쓴 답은 정의상 [근거] 밖이다(절대 규칙 1).
    if not raw or not any(e.get("sources") for e in evidence):
        print(f"[agent] ⚠ 빈 답변 또는 근거 0건(도구 {len(trace['tool_calls'])}회) — 단발 경로로 강등")
        return None
    trace["seed_hint"] = payload["seed"]["hint"]
    trace["check"] = (out.get("checkNote") or "")[:1500]   # 점검 턴 기록(평가·디버깅용 — 답변엔 미포함)
    trace["nudged"] = bool(out.get("nudged"))   # 계획만 쓰고 도구를 안 불러 1회 재촉했는가
    context = "\n\n---\n\n".join(e["context"] for e in evidence)
    srcs = _dedup([s for e in evidence for s in (e.get("sources") or [])])
    raw = strip_unsourced_links(raw, context)
    ans = rag_core._ensure_disclaimer(rag_core._ensure_enum_note(question, rag_core._postprocess(raw)))
    note = rag_core.post_answer_notes(question, ans, context, srcs)   # 수치·귀속·주제 게이트(근거=실제 읽은 것)
    if note:
        ans = ans.rstrip() + "\n\n" + note
    return {"answer": ans, "context": context, "srcs": srcs, "trace": trace}
