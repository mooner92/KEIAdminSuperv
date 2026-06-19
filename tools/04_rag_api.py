#!/usr/bin/env python3
"""
04_rag_api.py — KEI 행정 비서 API (한 프로세스, PM2 `kei-rag-api` 진입점)

두 가지 표면을 함께 제공한다(둘 다 rag_core 공유 → 모델 1회 로드):
  1) OpenAI 호환 RAG       : /v1/chat/completions, /v1/models  (Open WebUI 등 외부 연결용, 무상태)
  2) 비서 앱(상태형) 라우터 : /app/*  (로그인 + 채팅기록 + 멀티턴 + 메시지별 근거 — app_api.py)

왜? Open WebUI 내장 RAG는 청킹/출처표기를 통제 못함. 이 서버가 제N조 검색 + 근거 주입 +
[규정명 제N조] 출처를 강제한다. 우리 프론트(/)는 /app/* 를, Open WebUI는 /v1/* 를 쓴다.

실행:  uvicorn 04_rag_api:app --host 127.0.0.1 --port 9000   (tools/ 에서, env로 설정)
환경변수: CHROMA_DIR, RAG_COLLECTION, EMBED_MODEL, VLLM_BASE(=Ollama), LLM_MODEL, RAG_MODEL_ID, RAG_TOPK
         APP_DB, APP_SECRET_FILE (비서 앱 DB/세션키)
"""
import os
import threading
import time
import uuid

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import rag_core
from app_api import init_db
from app_api import router as app_router

MODEL_ID = os.environ.get("RAG_MODEL_ID", "kei-admin-rag")  # OpenAI 호환 모델 목록 이름

app = FastAPI(title="KEI 행정 비서 (RAG + 채팅기록)")
# 내부망 전용. 정적 프론트(다른 포트)에서 직접 호출/디버깅 가능하도록 허용.
# 운영은 server.js가 같은 오리진으로 프록시하므로 CORS에 의존하지 않는다.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(app_router)  # /app/* (로그인·채팅기록)
init_db()  # SQLite 테이블 보장(idempotent)


def _warm_loop():
    """기동 시 모델 예열 + 주기적 keep-alive로 LLM을 상주시켜 첫 질문 콜드스타트를 없앤다.
    GPU 여유가 충분(GPU0 비어있음)하므로 상주가 유리. OLLAMA_PING_SECONDS=0이면 주기 핑 끔."""
    try:
        rag_core.warmup()
        print("워밍업 완료: 임베딩(KURE-v1) 로드 + LLM 상주")
    except Exception as e:
        print(f"워밍업 실패(첫 요청 때 재시도): {type(e).__name__}: {e}")
    interval = int(os.environ.get("OLLAMA_PING_SECONDS", "240"))  # Ollama 기본 언로드(5분)보다 짧게
    while interval > 0:
        time.sleep(interval)
        try:
            rag_core.keepalive_once()
        except Exception as e:
            print(f"keepalive 실패: {type(e).__name__}: {e}")


# 데몬 스레드 → import(=uvicorn 기동)는 즉시 끝나고 백그라운드로 예열
threading.Thread(target=_warm_loop, name="kei-warmup", daemon=True).start()


class ChatReq(BaseModel):
    model: str | None = None
    messages: list
    temperature: float | None = 0.1
    stream: bool | None = False  # 본 구현은 비스트리밍(필요 시 SSE로 확장)


@app.get("/health")
def health():
    return {"status": "ok", "collection": rag_core.COLLECTION, "model_id": MODEL_ID,
            "embed_model": rag_core.EMBED_MODEL, "llm_base": rag_core.VLLM_BASE,
            "llm": rag_core.LLM_MODEL}


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [
        {"id": MODEL_ID, "object": "model", "created": int(time.time()), "owned_by": "kei"}]}


@app.post("/v1/chat/completions")
def chat(req: ChatReq):
    """무상태 OpenAI 호환 엔드포인트. 마지막 user 메시지로 검색하고, 그 앞은 멀티턴 맥락으로 전달."""
    msgs = req.messages or []
    # 마지막 user 메시지 = 이번 질문, 그 앞 = 이전 대화 맥락
    last_user_idx = next((i for i in range(len(msgs) - 1, -1, -1)
                          if msgs[i].get("role") == "user"), None)
    user_msg = msgs[last_user_idx]["content"] if last_user_idx is not None else ""
    history = msgs[:last_user_idx] if last_user_idx is not None else []
    context, srcs = rag_core.retrieve(user_msg)
    tags = [s["tag"] for s in srcs]
    try:
        answer = rag_core.answer(user_msg, context, history, temperature=req.temperature or 0.1)
    except Exception as e:
        answer = ("⚠️ 생성 모델에 연결하지 못했습니다. 회수된 근거 조문은 아래와 같습니다.\n\n"
                  + "\n".join(f"- {t}" for t in tags)
                  + f"\n\n(관리자 확인: {rag_core.VLLM_BASE} / {rag_core.LLM_MODEL} · {type(e).__name__})")
    return JSONResponse({
        "id": f"chatcmpl-{uuid.uuid4().hex[:12]}", "object": "chat.completion",
        "created": int(time.time()), "model": MODEL_ID,
        "choices": [{"index": 0, "finish_reason": "stop",
                     "message": {"role": "assistant", "content": answer}}],
        "usage": {},
        "x_retrieved": tags,    # 하위호환: 회수된 조문 태그 문자열
        "x_sources": srcs,      # 구조화 출처(규정명·조·분류·snippet·distance)
    })
