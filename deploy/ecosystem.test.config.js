/**
 * PM2 — **테스트 서버 3100** (2026-10-08 역할 교체 — 운영은 3101, deploy/ecosystem.prod.config.js).
 *
 *   테스트: 웹 3100 → RAG API 9000 · 작업트리 /KEIAdminSuperv (브랜치 dev)
 *
 * 새 기능은 여기(dev)에서 먼저 검증하고, 운영 반영은 운영자가 승격을 지시할 때만(dev → main).
 * 데이터는 교체 전 3100(구 운영)이 쓰던 것 — 실사용 없음(사용자 2명·최근 활동 0, 2026-10-08 실측).
 *
 *   pm2 start /KEIAdminSuperv/deploy/ecosystem.test.config.js --only kei-rag-api-test,kei-guide-test
 *
 * ⛔ Slack 알림 끔 — local.js의 토큰을 지운다(테스트 소음이 운영 채널로 가지 않게).
 * dev 편의: 인증코드 루프백 동봉(E2E용, 원격 요청엔 미동봉 — 보안 스캔 F22)·가입 RL 완화.
 */
const ROOT = "/KEIAdminSuperv";
const local = (() => {
  try {
    const l = { ...require(`${ROOT}/tools/ecosystem.local.js`) };
    delete l.SLACK_BOT_TOKEN; // 테스트는 알림 없음
    return l;
  } catch {
    return {};
  }
})();

module.exports = {
  apps: [
    {
      name: "kei-rag-api-test",
      script: `${ROOT}/tools/.venv/bin/uvicorn`,
      args: "04_rag_api:app --host 127.0.0.1 --port 9000",
      interpreter: "none",
      cwd: `${ROOT}/tools`,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      watch: false,
      env: {
        VLLM_BASE: "http://127.0.0.1:11436/v1",
        LLM_MODEL: "hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M",
        CHROMA_DIR: `${ROOT}/tools/chroma`,
        RAG_COLLECTION: "kei_regs",
        EMBED_MODEL: "nlpai-lab/KURE-v1",
        RAG_MODEL_ID: "kei-admin-rag",
        RAG_TOPK: "5",
        HF_HUB_OFFLINE: "1",
        OLLAMA_KEEP_ALIVE: "-1",
        OLLAMA_PING_SECONDS: "240",
        RAG_RERANK: "1",
        RAG_RERANK_DEVICE: "cuda:1",
        RAG_RERANK_POOL: "20",
        RAG_HYBRID: "1",
        APP_DB: `${ROOT}/tools/app.db`,
        VAULT_DIR: `${ROOT}/KEI-행정가이드`,
        APP_ADMINS: "",
        AUTOFIX_ENABLED: "0",
        RAG_AGENT: "1",
        RAG_AGENT_LLM: "kei-qwen35-agent:latest",
        RAG_AGENT_LLM_BASE: "http://127.0.0.1:11438/v1",
        RAG_AGENT_BUN: "/home/mhchoi/.nvm/versions/node/v22.23.0/bin/bun",
        APP_DEV_ECHO_CODE: "1", // ⛔ 테스트 전용 — 운영(3101)엔 절대 넣지 말 것
        APP_REG_RL_MAX: "100", // E2E 스위트가 가입 RL을 소진하지 않게(운영 기본 10)
        SLACK_BOT_TOKEN: "",
        PYTHONUNBUFFERED: "1",
        ...local,
        // 테스트 관리자 = 운영 관리자 + E2E 픽스처(admintest — verify-*.mjs의 /admin 검사용). 운영엔 없다.
        APP_ADMINS: [local.APP_ADMINS, "21963", "admintest"].filter(Boolean).join(","),
      },
    },
    {
      name: "kei-guide-test",
      script: `${ROOT}/web/server.js`,
      interpreter: "node",
      cwd: `${ROOT}/web`,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      watch: false,
      env: { HOST: "0.0.0.0", PORT: "3100", RAG_PORT: "9000" },
    },
  ],
};
