/**
 * PM2 — **운영(배포) 서버 3101** (2026-10-08 역할 교체 — 사용자에게 공유된 링크가 3101).
 *
 *   운영: 웹 3101 → RAG API 9001 · 작업트리 /home/mhchoi/kei-dev-0703 (브랜치 main)
 *   테스트: 웹 3100 → RAG API 9000 · /KEIAdminSuperv (브랜치 dev) — deploy/ecosystem.test.config.js
 *
 * 데이터(app.db 사용자·채팅 · 볼트 · chroma)는 교체 전 3101이 쓰던 것 그대로다(실사용자 23명이 여기 있다).
 * 디렉터리 이름(kei-dev-0703)은 역사적 이름일 뿐 — **이 트리가 운영**이다.
 *
 *   pm2 start /home/mhchoi/kei-dev-0703/deploy/ecosystem.prod.config.js --only kei-rag-api,kei-guide
 *   pm2 save
 *
 * ⛔ 운영 경화(교체 시 제거한 dev 편의): APP_DEV_ECHO_CODE · APP_REG_RL_MAX 완화 · 실재하지 않는 관리자
 *    자리표시자(admintest). 관리자·Slack 토큰은 tools/ecosystem.local.js(gitignore)에만 둔다.
 * ⚠ env는 **이 파일이 정본**이다. `pm2 restart --update-env`로 셸에서 덮어쓴 값은 다음 config 재시작 때
 *    사라진다(2026-10-06 실측: dev에 pm2 save로만 넣었던 RAG_HYBRID=1이 config 재시작으로 소실).
 * ⚠ 재시작: 부하 시 `pm2 restart <config>`가 errored로 끝날 수 있다 → status 확인 후
 *    `pm2 start <config> --only kei-rag-api`로 재기동하고 /health 200을 기다린다.
 */
const ROOT = "/home/mhchoi/kei-dev-0703";
const local = (() => { try { return require(`${ROOT}/tools/ecosystem.local.js`); } catch { return {}; } })();

module.exports = {
  apps: [
    {
      name: "kei-rag-api",
      script: "/KEIAdminSuperv/tools/.venv/bin/uvicorn", // venv 공유(절대경로)
      args: "04_rag_api:app --host 127.0.0.1 --port 9001",
      interpreter: "none",
      cwd: `${ROOT}/tools`,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      watch: false,
      env: {
        VLLM_BASE: "http://127.0.0.1:11436/v1", // 서비스 Ollama v0.31.1(kei-ollama-v031)
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
        RAG_RERANK_DEVICE: "cuda:1", // GPU는 공유·변동적 — OOM이면 밀집으로 우아하게 강등
        RAG_RERANK_POOL: "20",
        RAG_HYBRID: "1", // BM25+RRF(docs/71 A/B 합격 — 위험용어 41→54%). ⚠ 반드시 파일에(위 주석)
        APP_DB: `${ROOT}/tools/app.db`,
        APP_SECRET_FILE: `${ROOT}/tools/.app_secret`,
        VAULT_DIR: `${ROOT}/KEI-행정가이드`,
        APP_ADMINS: "", // ⛔ 커밋본은 비움 — 실계정은 ecosystem.local.js
        AUTOFIX_ENABLED: "0", // 오토픽스 관문 미격리(docs/63 §3) — 컨테이너화 전 금지
        TRACK_RETENTION_DAYS: "730",
        // 에이전트 답변(docs/74): 전용 Ollama 11438(⚠11437은 tincase-ollama). 채팅 적용은 플래그 agent_chat.
        RAG_AGENT: "1",
        RAG_AGENT_LLM: "kei-qwen35-agent:latest",
        RAG_AGENT_LLM_BASE: "http://127.0.0.1:11438/v1",
        RAG_AGENT_BUN: "/home/mhchoi/.nvm/versions/node/v22.23.0/bin/bun",
        // 운영자 알림(docs/66) — 토큰은 local.js. 미설정 = 발송 안 함(fail-safe)
        SLACK_BOT_TOKEN: "",
        SLACK_CHANNEL: "#horong",
        ALERT_MIN_SEV: "3",
        ALERT_MAX_PER_DAY: "50",
        PYTHONUNBUFFERED: "1",
        ...local,
      },
    },
    {
      name: "kei-guide",
      script: `${ROOT}/web/server.js`, // 의존성0 정적 서버 + 로그인 게이트(docs/44) — nginx 단독 대체 금지
      interpreter: "node",
      cwd: `${ROOT}/web`,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      watch: false,
      env: { HOST: "0.0.0.0", PORT: "3101", RAG_PORT: "9001" },
    },
    {
      // 제보 자동 분석(docs/51 §5·6) — 매시 5분 1회(autorestart:false). ⚠ 교체 시점에 정지 상태였다 —
      // 켤 때만 `--only kei-feedback-analyzer`로 시작. ⛔ 볼트·검수상태 불변(계획·알림만).
      name: "kei-feedback-analyzer",
      script: "/KEIAdminSuperv/tools/.venv/bin/python",
      args: "feedback_analyze.py",
      interpreter: "none",
      cwd: `${ROOT}/tools`,
      instances: 1,
      exec_mode: "fork",
      autorestart: false,
      cron_restart: "5 * * * *",
      watch: false,
      env: {
        VLLM_BASE: "http://127.0.0.1:11436/v1",
        LLM_MODEL: "hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M",
        APP_DB: `${ROOT}/tools/app.db`,
        PYTHONUNBUFFERED: "1",
      },
    },
  ],
};
