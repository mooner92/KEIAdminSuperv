/**
 * PM2 프로세스 정의 — KEI 행정 비서 **레거시 v1.0.0** (완전 격리 운영).
 *
 * main 브랜치의 v1.0.0 시점(태그 v1.0.0 = 36dc3fc)을 통째로 동결한 사본
 * `/.legacy-v1/` 를 별도 포트로 띄운다. 현행 개발(feat/0620, 3100/9000)과
 * 코드·벡터DB·채팅DB·세션키까지 100% 분리되어 서로 영향 없음.
 *
 *   현행(개발):  프론트 3100 → RAG API 9000  (tools/, web/)
 *   레거시(운영): 프론트 3101 → RAG API 9001  (.legacy-v1/)  ← 이 파일
 *
 * 동결 사본은 런타임 산출물이라 .gitignore 처리됨(out/docdata 규정 원문·chroma·
 * app.db·.app_secret 포함). 이 설정 파일만 레포에 추적되어 재현 가능하게 둔다.
 *
 * 사용:
 *   pm2 start /KEIAdminSuperv/deploy/ecosystem.legacy-v1.config.js
 *   pm2 save
 *   pm2 logs kei-rag-api-legacy
 *
 * 재동결(레거시를 다시 v1.0.0으로 굽기): deploy/README.md 의 "레거시 v1.0.0 동결" 절 참조.
 *
 * 공유 자원: 둘 다 같은 Ollama(127.0.0.1:11434, Qwen2.5-14B-Instruct)를 쓴다.
 * 모델 가중치는 Ollama가 1벌만 GPU에 상주시키므로 GPU 추가 부담 없음.
 * (임베딩 KURE-v1만 프로세스별로 1벌씩 로드 — GPU0 여유 충분)
 */
module.exports = {
  apps: [
    {
      name: "kei-rag-api-legacy",
      script: "/KEIAdminSuperv/tools/.venv/bin/uvicorn", // 동일 venv 재사용(절대경로)
      args: "04_rag_api:app --host 127.0.0.1 --port 9001",
      interpreter: "none",
      cwd: "/KEIAdminSuperv/.legacy-v1", // 동결된 .py(rag_core/app_api/04_rag_api)를 여기서 import
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      watch: false,
      env: {
        VLLM_BASE: "http://127.0.0.1:11434/v1", // Ollama(현행과 공유)
        LLM_MODEL: "hf.co/bartowski/Qwen2.5-14B-Instruct-GGUF:Q4_K_M",
        CHROMA_DIR: "/KEIAdminSuperv/.legacy-v1/chroma", // 동결 벡터DB(격리)
        RAG_COLLECTION: "kei_regs",
        EMBED_MODEL: "nlpai-lab/KURE-v1",
        RAG_MODEL_ID: "kei-admin-rag",
        RAG_TOPK: "5",
        APP_DB: "/KEIAdminSuperv/.legacy-v1/app.db", // 동결 채팅DB(격리)
        APP_SECRET_FILE: "/KEIAdminSuperv/.legacy-v1/.app_secret", // 동결 세션키(격리)
        HF_HUB_OFFLINE: "1",
        OLLAMA_KEEP_ALIVE: "-1",
        OLLAMA_PING_SECONDS: "240",
        PYTHONUNBUFFERED: "1",
      },
    },
    {
      name: "kei-guide-legacy",
      script: "/KEIAdminSuperv/.legacy-v1/server.js", // 동결 정적 서버
      interpreter: "node",
      cwd: "/KEIAdminSuperv/.legacy-v1", // ROOT = ./out (동결 빌드)
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      watch: false,
      env: {
        HOST: "0.0.0.0",
        PORT: "3101", // 레거시 프론트
        RAG_HOST: "127.0.0.1",
        RAG_PORT: "9001", // → kei-rag-api-legacy
      },
    },
  ],
};
