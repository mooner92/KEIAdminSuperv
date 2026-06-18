#!/usr/bin/env python3
"""
04_rag_api.py — 우리 RAG를 'OpenAI 호환 모델'로 노출 (Open WebUI가 그대로 붙음)

왜 필요? Open WebUI 내장 RAG는 청킹/출처표기를 우리 맘대로 못 통제함.
이 작은 API를 Open WebUI에 '모델'로 등록하면:
  - 채팅 UI/멀티유저/권한 = Open WebUI가 담당
  - 제N조 단위 검색 + 근거 주입 + [규정명 제N조] 출처 강제 = 이 서버가 담당
즉 예쁜 UI + 감사용 정확성/출처 통제를 둘 다 가져감.

실행:  uvicorn 04_rag_api:app --host 0.0.0.0 --port 9000
등록:  Open WebUI > 설정 > 연결 > OpenAI API
       Base URL = http://<서버IP>:9000/v1   (localhost 말고 실제 IP! Docker 네트워크 이슈)
       API Key  = EMPTY
"""
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from openai import OpenAI
import time, uuid

EMBED_MODEL = "nlpai-lab/KURE-v1"          # 02/03과 동일해야 함
CHROMA_DIR  = "./chroma"
VLLM_BASE   = "http://localhost:8000/v1"   # 기존 vLLM 엔드포인트
LLM_MODEL   = "Qwen/Qwen2.5-14B-Instruct"
MODEL_ID    = "kei-admin-rag"              # Open WebUI 모델 목록에 뜰 이름

SYSTEM = (
    "너는 KEI 행정 도우미다. 아래 [근거] 규정 조문만 사용해 답한다.\n"
    "1) [근거]에 없는 내용(금액·한도·기한 등)은 지어내지 말고 '규정에서 확인되지 않습니다'라고 한다.\n"
    "2) 신입도 이해하게 쉽게, 단계로 설명한다.\n"
    "3) 답변 끝에 사용한 출처를 [규정명 제N조] 형식으로 모두 표기한다.\n"
    "4) 마지막에 '최종 판단은 원문과 담당 부서 확인 바랍니다.'를 덧붙인다."
)

print("임베딩/벡터DB 로딩...")
import chromadb
from sentence_transformers import SentenceTransformer
_embed = SentenceTransformer(EMBED_MODEL)
_col = chromadb.PersistentClient(path=CHROMA_DIR).get_collection("kei_regs")
_llm = OpenAI(base_url=VLLM_BASE, api_key="EMPTY")
app = FastAPI(title="KEI Admin RAG (OpenAI-compatible)")

class ChatReq(BaseModel):
    model: str | None = None
    messages: list
    temperature: float | None = 0.1
    stream: bool | None = False  # 본 스켈레톤은 비스트리밍(필요시 SSE로 확장)

@app.get("/v1/models")
def models():
    return {"object": "list", "data": [
        {"id": MODEL_ID, "object": "model", "created": int(time.time()), "owned_by": "kei"}]}

def retrieve(query: str, k: int = 5):
    qv = _embed.encode([query], normalize_embeddings=True)[0].tolist()
    r = _col.query(query_embeddings=[qv], n_results=k)
    blocks, srcs = [], []
    for doc, m in zip(r["documents"][0], r["metadatas"][0]):
        tag = f"{m.get('규정명','')} {m.get('조','')}".strip()
        blocks.append(f"[{tag}]\n{doc}")
        srcs.append(tag)
    return "\n\n---\n\n".join(blocks), srcs

@app.post("/v1/chat/completions")
def chat(req: ChatReq):
    user_msg = next((m["content"] for m in reversed(req.messages)
                     if m.get("role") == "user"), "")
    context, srcs = retrieve(user_msg)
    out = _llm.chat.completions.create(
        model=LLM_MODEL, temperature=req.temperature or 0.1,
        messages=[{"role": "system", "content": SYSTEM},
                  {"role": "user", "content": f"[질문]\n{user_msg}\n\n[근거]\n{context}"}],
    )
    answer = out.choices[0].message.content
    return JSONResponse({
        "id": f"chatcmpl-{uuid.uuid4().hex[:12]}", "object": "chat.completion",
        "created": int(time.time()), "model": MODEL_ID,
        "choices": [{"index": 0, "finish_reason": "stop",
                     "message": {"role": "assistant", "content": answer}}],
        "usage": {}, "x_retrieved": srcs,   # 디버그용: 회수된 조문
    })
