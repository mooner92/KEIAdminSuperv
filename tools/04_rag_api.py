#!/usr/bin/env python3
"""
04_rag_api.py — KEI 행정 LLM API (한 프로세스, PM2 `kei-rag-api` 진입점)

두 가지 표면을 함께 제공한다(둘 다 rag_core 공유 → 모델 1회 로드):
  1) OpenAI 호환 RAG       : /v1/chat/completions, /v1/models  (Open WebUI 등 외부 연결용, 무상태)
  2) LLM 앱(상태형) 라우터 : /app/*  (로그인 + 채팅기록 + 멀티턴 + 메시지별 근거 — app_api.py)

왜? Open WebUI 내장 RAG는 청킹/출처표기를 통제 못함. 이 서버가 제N조 검색 + 근거 주입 +
[규정명 제N조] 출처를 강제한다. 우리 프론트(/)는 /app/* 를, Open WebUI는 /v1/* 를 쓴다.

실행:  uvicorn 04_rag_api:app --host 127.0.0.1 --port 9000   (tools/ 에서, env로 설정)
환경변수: CHROMA_DIR, RAG_COLLECTION, EMBED_MODEL, VLLM_BASE(=Ollama), LLM_MODEL, RAG_MODEL_ID, RAG_TOPK
         APP_DB, APP_SECRET_FILE (LLM 앱 DB/세션키)
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
import app_api  # 엔진·MaintNotice 접근(관측 알림)
import obs  # P0 관측 순수 로직(docs/56)
from app_api import init_db
from app_api import router as app_router

MODEL_ID = os.environ.get("RAG_MODEL_ID", "kei-admin-rag")  # OpenAI 호환 모델 목록 이름

# 보안(prod 하드닝): 대화형 문서(/docs·/redoc·/openapi.json)는 기본 비활성 — 내부 API 표면 최소화.
# dev에서 필요하면 APP_ENABLE_DOCS=1로 재노출(server.js 프록시 밖이라 직접 접근 시에만 의미).
_docs_on = os.environ.get("APP_ENABLE_DOCS") == "1"
app = FastAPI(
    title="KEI 행정 LLM (RAG + 채팅기록)",
    docs_url="/docs" if _docs_on else None,
    redoc_url="/redoc" if _docs_on else None,
    openapi_url="/openapi.json" if _docs_on else None,
)
# 내부망 전용. 정적 프론트(다른 포트)에서 직접 호출/디버깅 가능하도록 허용.
# 운영은 server.js가 같은 오리진으로 프록시하므로 CORS에 의존하지 않는다.
# ⛔ allow_credentials=True 를 절대 함께 켜지 말 것 — 와일드카드 오리진 + 자격증명이면
#    모든 외부 사이트가 사용자 인증 세션으로 /app/*(채팅기록·flags 관리·audit)를 읽는 취약점이 된다.
#    쿠키 인증은 same-origin(server.js 프록시)에서만 흐른다(현재 credentials 미허용이라 교차오리진 쿠키 차단).
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(app_router)  # /app/* (로그인·채팅기록)


# ─────────────────── P0 관측: "죽으면 안다" (docs/56) ───────────────────
# Sentry 전체 이식 대신 최소 P0만: ⓐ주기 헬스체크(_warm_loop에 얹음) ⓑ미처리 예외 알림.
# 둘 다 기존 MaintNotice(🔔 배지·브라우저 알림)를 재사용 — 새 테이블·탭 없음.
# 동기 사례: 재색인 후 dev API가 옛 chroma 핸들을 물어 채팅 전부 500인데 아무도 몰랐음.

def _maint_notice(kind: str, summary: str, detail: str = "") -> None:
    """MaintNotice 1건 생성(fail-safe — 알림 실패가 서비스에 영향 주지 않게)."""
    try:
        from sqlmodel import Session  # noqa: PLC0415
        with Session(app_api.engine) as s:
            s.add(app_api.MaintNotice(kind=kind, summary=summary[:200], detail_path=detail[:500]))
            s.commit()
    except Exception as e:  # noqa: BLE001
        print(f"[obs] MaintNotice 실패({type(e).__name__}) — 무시")


def _health_probe() -> tuple[bool, str]:
    import httpx  # noqa: PLC0415
    return obs.health_probe(rag_core.backend, httpx.get, rag_core.VLLM_BASE)


# 미처리 예외(500) 알림 — 지문+시간창 스로틀로 폭주 방지. HTTPException(4xx)는 대상 아님.
_err_throttle = obs.ErrorThrottle(int(os.environ.get("OBS_ERR_THROTTLE_SEC", "600")))


@app.exception_handler(Exception)
async def _on_unhandled(request, exc):  # noqa: ANN001
    import traceback  # noqa: PLC0415
    fp = f"{type(exc).__name__}:{request.url.path}"
    if _err_throttle.should_notify(fp):
        tb = "".join(traceback.format_exception_only(type(exc), exc))[:200]
        # ⛔ 프라이버시: 라우트 경로·예외형만 — 질문/입력값/쿼리스트링 미포함(docs/56 §5)
        _maint_notice("error", f"⛔ 서버 오류 {type(exc).__name__} — {request.url.path}", tb)
        print(f"[obs] 미처리 예외 알림: {fp} — {tb.strip()}")
    return JSONResponse({"error": {"message": "내부 오류가 발생했습니다.", "type": "internal_error"}},
                        status_code=500)
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
    healthy = True  # 상태 전이(정상↔이상)에서만 알림 — 매 주기 스팸 방지
    while interval > 0:
        time.sleep(interval)
        try:
            rag_core.keepalive_once()
        except Exception as e:
            print(f"keepalive 실패: {type(e).__name__}: {e}")
        # P0 헬스체크(docs/56): 이상 전이 시 🔔, 회복 전이 시 회복 알림
        try:
            ok, why = _health_probe()
            transition = obs.health_transition(healthy, ok, why)
            if transition:
                _maint_notice(*transition)
                print(f"[obs] 헬스 전이: {transition[1]}")
            healthy = ok
        except Exception as e:  # noqa: BLE001
            print(f"[obs] 헬스체크 예외(무시): {type(e).__name__}: {e}")


# 데몬 스레드 → import(=uvicorn 기동)는 즉시 끝나고 백그라운드로 예열
threading.Thread(target=_warm_loop, name="kei-warmup", daemon=True).start()


class ChatReq(BaseModel):
    model: str | None = None
    messages: list
    temperature: float | None = 0.1
    stream: bool | None = False  # 본 구현은 비스트리밍(필요 시 SSE로 확장)


@app.get("/health")
def health():
    """헬스체크(v1 ⑮/#49 심층화): 컬렉션 카운트 + Ollama 핑 + 조문 인덱스 로드 상태."""
    out = {"status": "ok", "collection": rag_core.COLLECTION, "model_id": MODEL_ID,
           "embed_model": rag_core.EMBED_MODEL, "llm": rag_core.LLM_MODEL}
    try:
        _, col, _ = rag_core.backend()
        out["chunks"] = col.count()
    except Exception as e:  # noqa: BLE001
        out["status"] = "degraded"; out["chroma_error"] = type(e).__name__
    try:
        import httpx
        r = httpx.get(rag_core.VLLM_BASE.rstrip("/").removesuffix("/v1") + "/api/tags", timeout=2)
        out["ollama"] = "ok" if r.status_code == 200 else f"http {r.status_code}"
    except Exception as e:  # noqa: BLE001
        out["status"] = "degraded"; out["ollama"] = type(e).__name__
    out["indexes"] = {"article_status": len(rag_core._ensure_article_status()),
                      "clause_xref": len(rag_core._ensure_clause_xref().get("edges", {}))}
    return out


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
    # 후속 질문을 직전 맥락으로 재작성한 독립 검색어로 회수(멀티턴 정확도↑). 답변은 원 질문으로.
    q_search = rag_core.condense_query(user_msg, history)
    context, srcs = rag_core.retrieve(q_search)
    tags = [s["tag"] for s in srcs]
    try:
        answer = rag_core.answer(user_msg, context, history, temperature=req.temperature or 0.1)
        note = rag_core.post_answer_notes(user_msg, answer, context, srcs)  # P0-1 수치 + P0-4 귀속(docs/22)
        if note:
            answer = answer.rstrip() + "\n\n" + note
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
