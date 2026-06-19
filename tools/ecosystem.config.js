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
      },
    },
  ],
};
