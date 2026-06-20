/**
 * PM2 프로세스 정의 — KEI 행정 비서 RAG API (OpenAI 호환).
 *
 * 04_rag_api.py 를 uvicorn으로 띄운다. 127.0.0.1 전용(외부 비노출):
 * 정적 프론트(server.js)가 /api/rag/* 를 이 포트로 프록시한다.
 *
 * 사용:
 *   pm2 start /KEIAdminSuperv/tools/ecosystem.config.js
 *   pm2 save
 *   pm2 logs kei-rag-api
 *
 * 검색=Chroma(KURE-v1), 생성=Ollama(Qwen2.5-14B-Instruct). vLLM이 아니라 Ollama다.
 */
module.exports = {
  apps: [
    {
      name: "kei-rag-api",
      script: ".venv/bin/uvicorn",
      args: "04_rag_api:app --host 127.0.0.1 --port 9000",
      interpreter: "none", // uvicorn 바이너리를 직접 실행
      cwd: "/KEIAdminSuperv/tools",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      watch: false,
      env: {
        VLLM_BASE: "http://127.0.0.1:11434/v1", // Ollama OpenAI 호환 엔드포인트
        LLM_MODEL: "hf.co/bartowski/Qwen2.5-14B-Instruct-GGUF:Q4_K_M",
        CHROMA_DIR: "/KEIAdminSuperv/tools/chroma",
        RAG_COLLECTION: "kei_regs",
        EMBED_MODEL: "nlpai-lab/KURE-v1",
        RAG_MODEL_ID: "kei-admin-rag",
        RAG_TOPK: "5",
        HF_HUB_OFFLINE: "1", // 임베딩 모델은 로컬 캐시 사용(망 호출 차단)
        OLLAMA_KEEP_ALIVE: "-1", // LLM 무한 상주(콜드스타트 방지). GPU0 여유 충분
        OLLAMA_PING_SECONDS: "240", // 주기 keep-alive(외부 언로드 대비 백스톱). 0이면 끔
        // 리랭커(P1.4): 밀집 top-20 → bge-reranker-v2-m3 재점수 → top-5. 평가 strict Hit@1 0.600→0.829.
        // 여유 GPU1에서 ~0.5s/질의. 실패 시 밀집으로 우아하게 강등(가드레일). 끄려면 RAG_RERANK=0.
        RAG_RERANK: "1",
        RAG_RERANK_DEVICE: "cuda:1", // 비어있는 GPU1(가득 찬 GPU0과 분리). CPU는 ~14s라 부적합
        RAG_RERANK_POOL: "20",
        PYTHONUNBUFFERED: "1", // print/로그 즉시 flush(PM2 로그 가시성)
      },
    },
  ],
};
