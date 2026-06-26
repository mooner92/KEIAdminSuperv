#!/usr/bin/env python3
"""rag_core.py — 검색·생성 공용 코어.

04_rag_api.py(OpenAI 호환 엔드포인트)와 app_api.py(상태형 채팅: 로그인/기록/멀티턴)가
이 코어를 공유한다 → 임베딩/벡터DB/LLM 클라이언트를 한 번만 로드(한 프로세스).

가드레일(절대 규칙): 근거 밖 내용 금지, 출처 [규정명 제N조], 면책 문구. 약화시키지 말 것.
"""
import os
import threading

EMBED_MODEL = os.environ.get("EMBED_MODEL", "nlpai-lab/KURE-v1")   # 02/03과 동일해야 함
CHROMA_DIR = os.environ.get("CHROMA_DIR", "tools/chroma")
COLLECTION = os.environ.get("RAG_COLLECTION", "kei_regs")
VLLM_BASE = os.environ.get("VLLM_BASE", "http://localhost:8000/v1")  # 실제로는 Ollama
LLM_MODEL = os.environ.get("LLM_MODEL", "Qwen/Qwen2.5-14B-Instruct")
TOPK = int(os.environ.get("RAG_TOPK", "5"))
# 하이브리드 검색(밀집 KURE-v1 + 어휘 BM25 → RRF 융합). 기본 off — 평가로 개선 입증 후 켠다.
HYBRID = os.environ.get("RAG_HYBRID", "0") not in ("0", "", "false", "False")
FUSION_POOL = int(os.environ.get("RAG_FUSION_POOL", "20"))  # 각 검색기에서 뽑는 후보 수
# RRF 가중치 [밀집, 어휘]. 강한 밀집을 약한 BM25가 끌어내리지 않게 밀집을 더 신뢰(기본 2:1).
RRF_WEIGHTS = [float(x) for x in os.environ.get("RAG_RRF_WEIGHTS", "2,1").split(",")]
# 리랭커(cross-encoder, 온프레미스). 밀집 top-pool을 (질의,청크) 재점수로 재정렬 → top-k.
RERANK = os.environ.get("RAG_RERANK", "0") not in ("0", "", "false", "False")
RERANK_MODEL = os.environ.get("RAG_RERANK_MODEL", "BAAI/bge-reranker-v2-m3")
RERANK_POOL = int(os.environ.get("RAG_RERANK_POOL", "20"))      # 재점수 후보 수
RERANK_DEVICE = os.environ.get("RAG_RERANK_DEVICE", "cpu")      # 운영은 cuda 권장(여유 GPU)
# 멀티턴 질의 재작성: 후속 질문("몇 퍼센트야?")을 직전 맥락을 복원한 '독립 검색어'로 바꿔 검색 정확도↑.
# 검색어만 바꾸고 답변 생성은 원 질문/근거 그대로(가드레일 불변). 기본 on, 첫 턴(history 없음)은 미적용.
REWRITE = os.environ.get("RAG_QUERY_REWRITE", "1") not in ("0", "", "false", "False")
# 섹션 다양성(P2.4): 절차 질의에서 규정이 top-k를 독점해 ERP(시스템)·가이드가 밀릴까 봐 만든 좌석 보장.
# ⛔ 평가 결과 이득 없음 → 기본 off(opt-in). 밀집(KURE-v1)이 이미 규정+가이드+시스템+용어를 골고루
# 회수하므로(측정: off=on 동일) 강제 승격 불필요. 하이브리드(P1.4)와 같은 판단 — 인프라만 보존.
SECTION_DIVERSITY = os.environ.get("RAG_SECTION_DIVERSITY", "0") not in ("0", "", "false", "False")
DIVERSITY_GATE = int(os.environ.get("RAG_DIVERSITY_GATE", "8"))  # 이 순위 안에 있어야 좌석 승격(관련성 게이트)
# 모델 상주(콜드스타트 방지). -1 = 무한 상주(언로드 안 함). "30m" 등 Ollama keep_alive 값도 가능.
KEEP_ALIVE = os.environ.get("OLLAMA_KEEP_ALIVE", "-1")


def _keep_alive():
    try:
        return int(KEEP_ALIVE)
    except (TypeError, ValueError):
        return KEEP_ALIVE


SYSTEM = (
    "너는 KEI 행정 도우미다. 아래 [근거] 규정 조문만 사용해 답한다.\n"
    "1) [근거]에 없는 내용(금액·한도·기한 등)은 지어내지 말고 '규정에서 확인되지 않습니다'라고 한다.\n"
    "2) 반드시 두괄식으로 답한다. 답변 맨 앞에 질문에 대한 핵심 결론을 한두 문장으로 굵게(**…**) 먼저 제시한다."
    " 금액·가부·기한 질문이면 그 값이나 가부를 첫 문장에서 바로 답한다. 절차·단계 나열은 결론 뒤에 둔다.\n"
    "3) 결론은 짧게. 그다음 본문은 충실하게 — 근거·조건과 구체적 처리 방법(신청 메뉴·화면 경로·단계·필요 서식·금액 등 [근거]에 있는 실무 정보)을 빠뜨리지 말고 신입도 알기 쉽게 1.2.3. 단계로 설명한다.\n"
    "4) 답변 끝에 사용한 출처를 [규정명 제N조] 형식으로 표기하되, 가장 핵심이 된 조문을 맨 앞에 둔다.\n"
    "5) 마지막에 '최종 판단은 원문과 담당 부서 확인 바랍니다.'를 덧붙인다.\n"
    "6) 이전 대화 맥락을 참고하되, 사실 근거는 항상 이번 [근거]에서만 가져온다.\n"
    "7) [근거]에 '(ERP 시스템)' 항목이 있으면, 그 메뉴·처리 경로를 '처리 방법'에 함께 안내한다"
    " (근거에 없는 경로·서식명은 지어내지 않는다).\n"
    "8) 이전 대화에서 다루던 대상·주제(예: 국내출장)를 사용자가 바꾸지 않았으면 끝까지 같은 대상으로 답한다."
    " [근거]가 다른 대상(예: 국외출장)만 담고 있으면, 그 대상의 내용은 근거에서 확인되지 않는다고 밝히고"
    " 임의로 대상을 바꾸지 않는다."
)

# 가드레일(절대 규칙 #4): 모든 답변 끝에 면책 문구. 14B가 종종 누락(평가셋 측정 ~19%)하므로
# 모델 출력에 없으면 결정적으로 덧붙여 100% 보장한다(약화 아닌 강화).
DISCLAIMER = "최종 판단은 원문과 담당 부서 확인 바랍니다."
_DISC_KEY = "최종 판단은"  # 모델이 표현을 살짝 바꿔도 중복 안 붙도록 핵심 어구로 감지


def _ensure_disclaimer(text: str) -> str:
    t = text or ""
    if _DISC_KEY in t:
        return t
    return (t.rstrip() + "\n\n" + DISCLAIMER) if t.strip() else DISCLAIMER


CONDENSE_SYS = (
    "너는 검색어 재작성기다. [대화]를 참고해 [후속질문]을, 그 자체로 의미가 통하는 "
    "'독립 질문' 한 줄로 바꾼다.\n"
    "- 대화에서 생략된 주제·대상을 복원한다(예: '몇 퍼센트야?'는 직전 주제를 넣어 완성).\n"
    "- ⛔ 후속질문이 그 자체로 완성돼 보여도, 직전 대화의 핵심 대상·주제(특정 제도·문서·출장 종류 등)를 "
    "검색어에 반드시 포함한다. 예: 직전이 '국내출장 보고'면 후속 'ERP에서 어떻게 해?'는 "
    "'국내출장 출장복명서 ERP 작성·제출 방법'으로 재작성(임의로 '국외'로 바꾸지 않는다).\n"
    "- 새로운 사실·추측을 더하지 않는다. 질문 의도만 보존한다.\n"
    "- 출력은 재작성된 질문 한 줄만. 따옴표·설명·접두어 금지."
)

_state: dict = {}
_lock = threading.Lock()


def backend():
    """임베딩/벡터DB/LLM 클라이언트를 첫 사용 시 한 번만 로드(스레드 안전 — 워밍업/요청 경쟁 방지)."""
    if "embed" not in _state:
        with _lock:
            if "embed" not in _state:
                import chromadb
                from openai import OpenAI
                from sentence_transformers import SentenceTransformer
                print(f"임베딩/벡터DB 로딩... ({EMBED_MODEL}, {CHROMA_DIR}/{COLLECTION})")
                _state["embed"] = SentenceTransformer(EMBED_MODEL)
                _state["col"] = chromadb.PersistentClient(path=CHROMA_DIR).get_collection(COLLECTION)
                _state["llm"] = OpenAI(base_url=VLLM_BASE, api_key="EMPTY")
    return _state["embed"], _state["col"], _state["llm"]


def condense_query(question: str, history=None, enabled: bool = None) -> str:
    """멀티턴 후속 질문을 직전 맥락을 복원한 '독립 검색어'로 재작성(검색 정확도↑).

    - history 없으면(첫 턴) 원 질문 그대로. enabled=None이면 환경변수 RAG_QUERY_REWRITE를 따름.
    - ⛔ 검색어만 바꾼다. 답변 생성은 원 질문/근거로 — 가드레일·사실성 불변.
    - 실패(LLM 오류 등) 시 원 질문으로 우아하게 강등.
    """
    use = REWRITE if enabled is None else enabled
    recent = [h for h in (history or [])
              if h.get("role") in ("user", "assistant") and h.get("content")][-6:]
    if not use or not recent:
        return question
    try:
        _, _, llm = backend()
        hist_text = "\n".join(
            f"{'사용자' if h['role'] == 'user' else '도우미'}: {h['content'][:500]}" for h in recent)
        out = llm.chat.completions.create(
            model=LLM_MODEL, temperature=0.0, max_tokens=80,
            messages=[{"role": "system", "content": CONDENSE_SYS},
                      {"role": "user", "content": f"[대화]\n{hist_text}\n\n[후속질문]\n{question}\n\n[독립 질문]"}],
            extra_body={"keep_alive": _keep_alive()},
        )
        rq = (out.choices[0].message.content or "").strip().strip('"').strip()
        rq = rq.splitlines()[0].strip() if rq else ""
        return rq if len(rq) >= 2 else question  # 비었거나 너무 짧으면 원문
    except Exception:  # noqa: BLE001 — 재작성 실패는 원 질문으로 강등(서비스 영향 없음)
        return question


def _ensure_bm25():
    """첫 하이브리드 사용 시 컬렉션 전체로 BM25 어휘 인덱스 구축(스레드 안전, 1회)."""
    if "bm25" not in _state:
        with _lock:
            if "bm25" not in _state:
                _, col, _ = backend()
                got = col.get(include=["documents", "metadatas"])  # 전체 청크
                ids, docs, metas = got["ids"], got["documents"], got["metadatas"]
                from bm25_index import BM25
                _state["allmap"] = {i: (d, m) for i, d, m in zip(ids, docs, metas)}
                _state["bm25"] = BM25(ids, docs)
    return _state["bm25"]


def _src(doc, m, dist):
    name = (m.get("규정명") or "").strip()
    article = (m.get("조") or "").strip()
    return {
        "규정명": name, "조": article,
        "분류": (m.get("분류") or "").strip(),
        "slug": (m.get("slug") or m.get("파일") or "").strip(),
        "type": (m.get("type") or "").strip(),   # regulation|guide|system|term → UI에서 ERP/서식 칩
        "tag": f"{name} {article}".strip(),
        "snippet": doc[:240].replace("\n", " ").strip(),
        "distance": round(float(dist), 4) if dist is not None else None,
    }


def _select_diverse(order, k, typeof, gate=None):
    """섹션 다양성 선택: 규정이 top-k를 독점하지 않게 ERP(시스템)·가이드에 좌석을 보장한다.
    - 후보 순위(order) 상위 gate 안에 해당 섹션이 있을 때만 승격(무관한 섹션 강제 노출 방지)
    - 규정은 최소 max(1,k-2)개 유지(법적 근거 보존). 좌석은 가장 낮은 순위 규정과 교체.
    원래 순위 순서는 보존(삽입으로 흐트러지지 않게 정렬)."""
    chosen = list(order[:k])
    if len(order) <= k:
        return chosen
    g = gate or DIVERSITY_GATE
    pool_gate = order[:max(k, g)]
    keep_reg = max(1, k - 2)
    for typ in ("system", "guide"):   # ERP 경로 우선, 그다음 가이드
        if any(typeof(i) == typ for i in chosen):
            continue
        avail = [i for i in pool_gate if typeof(i) == typ and i not in chosen]
        if not avail:
            continue
        # 교체 대상: chosen에서 가장 낮은 순위의 규정(단, 규정 최소 수 보존)
        n_reg = sum(1 for i in chosen if typeof(i) == "regulation")
        victim = next((i for i in reversed(chosen)
                       if typeof(i) == "regulation" and n_reg > keep_reg), None)
        if victim is None:  # 규정 더 못 빼면 reserve 아닌(term 등) 가장 낮은 순위 교체
            victim = next((i for i in reversed(chosen)
                           if typeof(i) not in ("system", "guide", "regulation")), None)
        if victim is None:
            continue
        chosen[chosen.index(victim)] = avail[0]
    chosen.sort(key=order.index)   # 원래 순위 순서 유지
    return chosen


def _reranker():
    """cross-encoder 리랭커를 첫 사용 시 1회 로드(스레드 안전)."""
    if "rerank" not in _state:
        with _lock:
            if "rerank" not in _state:
                from sentence_transformers import CrossEncoder
                print(f"리랭커 로딩... ({RERANK_MODEL}, {RERANK_DEVICE})")
                _state["rerank"] = CrossEncoder(RERANK_MODEL, max_length=512, device=RERANK_DEVICE)
    return _state["rerank"]


def retrieve(query: str, k: int = TOPK, hybrid: bool = None, rerank: bool = None,
             section_diversity: bool = None):
    """질의 → 관련 조문 top-k 회수. (근거 컨텍스트 문자열, 구조화 출처 리스트) 반환.

    hybrid/rerank=None이면 환경변수(RAG_HYBRID/RAG_RERANK)를 따른다.
      - hybrid: 밀집(KURE-v1)+어휘(BM25)를 RRF로 융합(순위 기반).
      - rerank: 후보 top-pool을 cross-encoder로 (질의,청크) 재점수해 재정렬 → top-k.
      - section_diversity: 규정 독점 방지(ERP/가이드 좌석 보장, RAG_SECTION_DIVERSITY).
    둘 다면 융합 결과를 후보로 리랭크한다.
    """
    embed, col, _ = backend()
    use_hybrid = HYBRID if hybrid is None else hybrid
    use_rerank = RERANK if rerank is None else rerank
    use_div = SECTION_DIVERSITY if section_diversity is None else section_diversity
    pool = k
    if use_hybrid:
        pool = max(pool, FUSION_POOL)
    if use_rerank:
        pool = max(pool, RERANK_POOL)
    if use_div:  # 승격 후보가 top-k 밖에도 있으려면 pool을 gate 이상으로 확장(밀집 단독에서도 작동)
        pool = max(pool, FUSION_POOL, DIVERSITY_GATE)

    qv = embed.encode([query], normalize_embeddings=True)[0].tolist()
    r = col.query(query_embeddings=[qv], n_results=pool,
                  include=["documents", "metadatas", "distances"])
    dense_ids = r["ids"][0]
    dense = {i: (doc, m, dist) for i, doc, m, dist
             in zip(dense_ids, r["documents"][0], r["metadatas"][0], r["distances"][0])}

    def getdoc(i):
        if i in dense:
            return dense[i]
        d, m = _state["allmap"][i]
        return d, m, None

    if use_hybrid:
        bm = _ensure_bm25()
        from bm25_index import rrf
        lex_ids = [i for i, _ in bm.search(query, n=pool)]
        cand = [i for i, _ in rrf([dense_ids, lex_ids], top=pool, weights=RRF_WEIGHTS)]
    else:
        cand = dense_ids[:pool]

    rscore = {}
    if use_rerank and cand:
        try:
            scores = _reranker().predict([(query, getdoc(i)[0][:2000]) for i in cand])
            ranked = sorted(zip(cand, (float(s) for s in scores)), key=lambda x: -x[1])
            order = [i for i, _ in ranked]
            rscore = {i: s for i, s in ranked}
        except Exception as e:  # noqa: BLE001 — 리랭커 실패(예: GPU OOM)는 밀집 순서로 우아하게 강등
            print(f"⚠ 리랭커 실패 → 밀집 순서로 강등: {e}")
            order = list(cand)
    else:
        order = list(cand)

    if use_div and len(order) > k:
        chosen = _select_diverse(order, k, lambda i: (getdoc(i)[1] or {}).get("type", ""))
    else:
        chosen = order[:k]

    blocks, srcs = [], []
    for i in chosen:
        doc, m, dist = getdoc(i)
        s = _src(doc, m, dist)
        if i in rscore:
            s["rerank"] = round(rscore[i], 4)
        srcs.append(s)
        label = s["tag"] + (" (ERP 시스템)" if s.get("type") == "system" else "")
        blocks.append(f"[{label}]\n{doc}")
    return "\n\n---\n\n".join(blocks), srcs


def _build_messages(question: str, context: str, history=None):
    """system + (선택)이전 대화 + (이번 질문+근거). 멀티턴은 history를 LLM에 재생(replay).

    history: [{"role": "user"|"assistant", "content": str}, ...] (원문 질문/답변, 근거 미포함).
    """
    msgs = [{"role": "system", "content": SYSTEM}]
    for h in history or []:
        role = h.get("role")
        content = h.get("content")
        if role in ("user", "assistant") and content:
            msgs.append({"role": role, "content": content})
    msgs.append({"role": "user", "content": f"[질문]\n{question}\n\n[근거]\n{context}"})
    return msgs


def answer(question: str, context: str, history=None, temperature: float = 0.1) -> str:
    """근거 주입 + (선택)이전 대화 맥락으로 답변 생성(비스트리밍)."""
    _, _, llm = backend()
    out = llm.chat.completions.create(
        model=LLM_MODEL, temperature=temperature,
        messages=_build_messages(question, context, history),
        extra_body={"keep_alive": _keep_alive()},  # 매 요청마다 상주 재확인
    )
    return _ensure_disclaimer(out.choices[0].message.content or "")


def answer_stream(question: str, context: str, history=None, temperature: float = 0.1):
    """answer()의 스트리밍 버전 — LLM 토큰을 순차적으로 yield(제너레이터)."""
    _, _, llm = backend()
    stream = llm.chat.completions.create(
        model=LLM_MODEL, temperature=temperature,
        messages=_build_messages(question, context, history), stream=True,
        extra_body={"keep_alive": _keep_alive()},  # 매 요청마다 상주 재확인
    )
    seen = ""
    for chunk in stream:
        try:
            delta = chunk.choices[0].delta.content
        except (AttributeError, IndexError):
            delta = None
        if delta:
            seen += delta
            yield delta
    # 가드레일: 스트림 본문에 면책 문구가 없으면 마지막에 덧붙여 보장(중복 방지 감지 포함)
    if _DISC_KEY not in seen:
        yield ("\n\n" + DISCLAIMER) if seen.strip() else DISCLAIMER


def keepalive_once():
    """LLM을 메모리에 상주시키는 초경량 호출(1토큰). keep_alive로 언로드 타이머를 재설정."""
    _, _, llm = backend()
    llm.chat.completions.create(
        model=LLM_MODEL, temperature=0, max_tokens=1,
        messages=[{"role": "user", "content": "ping"}],
        extra_body={"keep_alive": _keep_alive()},
    )


def warmup():
    """서버 기동 시 백그라운드로 호출 → 임베딩/벡터DB 로드 + LLM 상주(첫 질문 콜드스타트 제거)."""
    embed, _, _ = backend()
    embed.encode(["워밍업"], normalize_embeddings=True)  # 임베딩 연산 경로까지 예열
    if RERANK:  # 리랭커 켜져 있으면 미리 로드(첫 질의 콜드스타트 제거)
        try:
            _reranker().predict([("워밍업", "워밍업 청크")])
        except Exception as e:  # noqa: BLE001
            print(f"⚠ 리랭커 워밍업 실패(런타임에 밀집 강등): {e}")
    keepalive_once()
