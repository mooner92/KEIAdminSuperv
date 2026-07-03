/**
 * PM2 — KEI 행정 LLM **개발/테스트 서버 (feat/0703)**.
 *
 * 프로덕션 v1.0.0(현행 3100/9000, /KEIAdminSuperv 메인 트리, feat/0620 동결)과
 * **완전 격리**해 별도 포트로 띄운다. worktree/벡터DB/채팅DB/세션키까지 분리.
 *
 *   프로덕션(v1.0.0): 프론트 3100 → RAG API 9000  (/KEIAdminSuperv, tools/·web/)  ← 건드리지 않음
 *   개발(테스트):     프론트 3101 → RAG API 9001  (/home/mhchoi/kei-dev-0703)      ← 이 파일
 *
 * worktree = git worktree(브랜치 feat/0703). 볼트(KEI-행정가이드)는 gitignore라 worktree에 없어
 * 빌드 시 VAULT_DIR로 프로덕션 볼트를 read-only 소비한다. chroma/app.db/.app_secret은 이 dir에 격리.
 * Ollama(127.0.0.1:11434)와 tools/.venv는 공유(모델 1벌 상주 — GPU 추가부담 없음).
 *
 * 사용:
 *   pm2 delete kei-guide-legacy kei-rag-api-legacy   # 옛 레거시 슬롯 회수(선택)
 *   pm2 start /home/mhchoi/kei-dev-0703/deploy/ecosystem.dev-0703.config.js
 *   pm2 save
 * 재빌드(프론트 변경 시): cd /home/mhchoi/kei-dev-0703/web && nvm use 22 &&
 *   VAULT_DIR=/KEIAdminSuperv/KEI-행정가이드 npm run build && pm2 reload kei-guide-dev
 */
module.exports = {
  apps: [
    {
      name: "kei-rag-api-dev",
      script: "/KEIAdminSuperv/tools/.venv/bin/uvicorn", // venv 공유(절대경로)
      args: "04_rag_api:app --host 127.0.0.1 --port 9001",
      interpreter: "none",
      cwd: "/home/mhchoi/kei-dev-0703/tools", // dev worktree의 .py를 import
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      watch: false,
      env: {
        VLLM_BASE: "http://127.0.0.1:11434/v1",
        // Qwen3-14B(GGUF Q4_K_M). Ollama 레지스트리 차단됨 → hf.co/ 로 pull.
        // rag_core가 /no_think로 사고모드 끄고 <think> 방어 제거(NO_THINK 자동 on: 모델명에 qwen3).
        LLM_MODEL: "hf.co/Qwen/Qwen3-14B-GGUF:Q4_K_M",
        CHROMA_DIR: "/home/mhchoi/kei-dev-0703/tools/chroma", // 격리 벡터DB(프로덕션 사본)
        RAG_COLLECTION: "kei_regs",
        EMBED_MODEL: "nlpai-lab/KURE-v1",
        RAG_MODEL_ID: "kei-admin-rag",
        RAG_TOPK: "5",
        HF_HUB_OFFLINE: "1",
        OLLAMA_KEEP_ALIVE: "-1",
        OLLAMA_PING_SECONDS: "240",
        // ⚠ 리랭커 off: GPU1이 프로덕션 리랭커+Ollama로 꽉 차 dev 리랭커는 OOM(매 질의 실패→밀집 강등,
        // 로그 스팸·지연). dev는 '밀집'으로 돈다(프롬프트·콘텐츠 테스트엔 충분). 프로덕션=리랭커라 검색 순위는 다를 수 있음.
        // GPU 여유 생기면 RAG_RERANK=1 + RAG_RERANK_DEVICE=cuda:1로 프로덕션과 동일하게.
        RAG_RERANK: "0",
        APP_DB: "/home/mhchoi/kei-dev-0703/tools/app.db", // 격리 채팅DB(신규)
        APP_SECRET_FILE: "/home/mhchoi/kei-dev-0703/tools/.app_secret", // 격리 세션키(신규)
        APP_ADMINS: "21963",
        PYTHONUNBUFFERED: "1",
      },
    },
    {
      name: "kei-guide-dev",
      script: "/home/mhchoi/kei-dev-0703/web/server.js", // 의존성0 정적 서버(빌드 out/ 서빙)
      interpreter: "node",
      cwd: "/home/mhchoi/kei-dev-0703/web",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      watch: false,
      env: {
        HOST: "0.0.0.0",
        PORT: "3101",
        RAG_PORT: "9001", // /api/* → dev RAG API(9001)로 프록시
      },
    },
  ],
};
