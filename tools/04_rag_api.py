#!/usr/bin/env python3
"""
04_rag_api.py — 우리 RAG를 'OpenAI 호환 모델'로 노출 (Open WebUI가 그대로 붙음)

왜 필요? Open WebUI 내장 RAG는 청킹/출처표기를 우리 맘대로 못 통제함.
이 작은 API를 Open WebUI에 '모델'로 등록하면:
  - 채팅 UI/멀티유저/권한 = Open WebUI가 담당
  - 제N조 단위 검색 + 근거 주입 + [규정명 제N조] 출처 강제 = 이 서버가 담당
즉 예쁜 UI + 감사용 정확성/출처 통제를 둘 다 가져감.

실행:  uvicorn 04_rag_api:app --host 0.0.0.0 --port 9000
       (tools/ 에서 실행. 환경변수로 경로/엔드포인트 조정 가능)
등록:  Open WebUI > 설정 > 연결 > OpenAI API
       Base URL = http://<서버 실제 IP>:9000/v1   (localhost 말고 실제 IP! Docker 네트워크 이슈)
       API Key  = EMPTY

환경변수: CHROMA_DIR, RAG_COLLECTION, EMBED_MODEL, VLLM_BASE, LLM_MODEL, RAG_MODEL_ID, RAG_TOPK
"""
import os
import time
import uuid

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

EMBED_MODEL = os.environ.get("EMBED_MODEL", "nlpai-lab/KURE-v1")   # 02/03과 동일해야 함
CHROMA_DIR = os.environ.get("CHROMA_DIR", "tools/chroma")
COLLECTION = os.environ.get("RAG_COLLECTION", "kei_regs")
VLLM_BASE = os.environ.get("VLLM_BASE", "http://localhost:8000/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "Qwen/Qwen2.5-14B-Instruct")
MODEL_ID = os.environ.get("RAG_MODEL_ID", "kei-admin-rag")        # Open WebUI 모델 목록 이름
TOPK = int(os.environ.get("RAG_TOPK", "5"))

SYSTEM = (
    "너는 KEI 행정 도우미다. 아래 [근거] 규정 조문만 사용해 답한다.\n"
    "1) [근거]에 없는 내용(금액·한도·기한 등)은 지어내지 말고 '규정에서 확인되지 않습니다'라고 한다.\n"
    "2) 신입도 이해하게 쉽게, 단계로 설명한다.\n"
    "3) 답변 끝에 사용한 출처를 [규정명 제N조] 형식으로 모두 표기한다.\n"
    "4) 마지막에 '최종 판단은 원문과 담당 부서 확인 바랍니다.'를 덧붙인다."
)

app = FastAPI(title="KEI Admin RAG (OpenAI-compatible)")
_state: dict = {}


def backend():
    """임베딩/벡터DB/LLM 클라이언트를 첫 요청 때 한 번만 로드(모델 등록은 즉시 응답)."""
    if "embed" not in _state:
        import chromadb
        from openai import OpenAI
        from sentence_transformers import SentenceTransformer
        print(f"임베딩/벡터DB 로딩... ({EMBED_MODEL}, {CHROMA_DIR}/{COLLECTION})")
        _state["embed"] = SentenceTransformer(EMBED_MODEL)
        _state["col"] = chromadb.PersistentClient(path=CHROMA_DIR).get_collection(COLLECTION)
        _state["llm"] = OpenAI(base_url=VLLM_BASE, api_key="EMPTY")
    return _state["embed"], _state["col"], _state["llm"]


class ChatReq(BaseModel):
    model: str | None = None
    messages: list
    temperature: float | None = 0.1
    stream: bool | None = False  # 본 구현은 비스트리밍(필요 시 SSE로 확장)


@app.get("/health")
def health():
    return {"status": "ok", "collection": COLLECTION, "model_id": MODEL_ID,
            "embed_model": EMBED_MODEL, "vllm": VLLM_BASE, "llm": LLM_MODEL}


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [
        {"id": MODEL_ID, "object": "model", "created": int(time.time()), "owned_by": "kei"}]}


def retrieve(embed, col, query: str, k: int = TOPK):
    qv = embed.encode([query], normalize_embeddings=True)[0].tolist()
    r = col.query(query_embeddings=[qv], n_results=k, include=["documents", "metadatas"])
    blocks, srcs = [], []
    for doc, m in zip(r["documents"][0], r["metadatas"][0]):
        tag = f"{m.get('규정명', '')} {m.get('조', '')}".strip()
        blocks.append(f"[{tag}]\n{doc}")
        srcs.append(tag)
    return "\n\n---\n\n".join(blocks), srcs


@app.post("/v1/chat/completions")
def chat(req: ChatReq):
    embed, col, llm = backend()
    user_msg = next((m["content"] for m in reversed(req.messages)
                     if m.get("role") == "user"), "")
    context, srcs = retrieve(embed, col, user_msg)
    try:
        out = llm.chat.completions.create(
            model=LLM_MODEL, temperature=req.temperature or 0.1,
            messages=[{"role": "system", "content": SYSTEM},
                      {"role": "user", "content": f"[질문]\n{user_msg}\n\n[근거]\n{context}"}],
        )
        answer = out.choices[0].message.content
    except Exception as e:
        # vLLM 미연결 시에도 회수 근거는 돌려줘 운영자가 원인 파악 가능하게
        answer = ("⚠️ 생성 모델(vLLM)에 연결하지 못했습니다. 회수된 근거 조문은 아래와 같습니다.\n\n"
                  + "\n".join(f"- {s}" for s in srcs)
                  + f"\n\n(관리자 확인: {VLLM_BASE} / {LLM_MODEL} · {type(e).__name__})")
    return JSONResponse({
        "id": f"chatcmpl-{uuid.uuid4().hex[:12]}", "object": "chat.completion",
        "created": int(time.time()), "model": MODEL_ID,
        "choices": [{"index": 0, "finish_reason": "stop",
                     "message": {"role": "assistant", "content": answer}}],
        "usage": {}, "x_retrieved": srcs,   # 디버그용: 회수된 조문
    })
