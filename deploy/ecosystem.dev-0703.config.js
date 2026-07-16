/**
 * PM2 — KEI 행정 LLM **개발/테스트 서버 (feat/0703)**.
 *
 * 프로덕션 v1.0.0(현행 3100/9000, /KEIAdminSuperv 메인 트리, feat/0620 동결)과
 * **완전 격리**해 별도 포트로 띄운다. worktree/벡터DB/채팅DB/세션키까지 분리.
 *
 *   프로덕션(v1.0.0): 프론트 3100 → RAG API 9000  (/KEIAdminSuperv, tools/·web/)  ← 건드리지 않음
 *   개발(테스트):     프론트 3101 → RAG API 9001  (/home/mhchoi/kei-dev-0703)      ← 이 파일
 *
 * worktree = git worktree(브랜치 feat/0703). 볼트(KEI-행정가이드)는 gitignore.
 * ── 2026-07-04 완전격리 ── dev 전용 볼트 복사본(/home/mhchoi/kei-dev-0703/KEI-행정가이드)을 두고
 * 빌드·임베딩이 이걸 소비한다 → dev 콘텐츠 편집이 prod 볼트에 절대 영향 없음. chroma/app.db/.app_secret도 격리.
 * ⚠ 아직 공유(미격리): 생성 LLM(Ollama 11436=kei-ollama-v031, Qwen3.5-9B)과 tools/.venv.
 *   dev 전용 모델 실험이 필요하면 dev용 Ollama를 별도 포트로 띄워야 함.
 *
 * 사용:
 *   pm2 delete kei-guide-legacy kei-rag-api-legacy   # 옛 레거시 슬롯 회수(선택)
 *   pm2 start /home/mhchoi/kei-dev-0703/deploy/ecosystem.dev-0703.config.js
 *   pm2 save
 * 재빌드(프론트 변경 시): cd /home/mhchoi/kei-dev-0703/web && nvm use 22 &&
 *   VAULT_DIR=/home/mhchoi/kei-dev-0703/KEI-행정가이드 npm run build && pm2 reload kei-guide-dev   # dev 전용 볼트
 * 재임베딩(콘텐츠 변경 시): cd tools && python 02_chunk_and_embed.py \
 *   --vault /home/mhchoi/kei-dev-0703/KEI-행정가이드 --db /home/mhchoi/kei-dev-0703/tools/chroma   # dev 전용 볼트→dev chroma
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
        VLLM_BASE: "http://127.0.0.1:11436/v1", // 격리 Ollama v0.31.1(kei-ollama-v031) — 11434(0.24.0)는 qwen3_5 미지원
        // Qwen3.5-9B(GGUF Q4_K_M, unsloth). rag_core가 reasoning_effort:none(+think:false) 사고 off + 공백결함 정규화(자동).
        LLM_MODEL: "hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M",
        CHROMA_DIR: "/home/mhchoi/kei-dev-0703/tools/chroma", // 격리 벡터DB(프로덕션 사본)
        RAG_COLLECTION: "kei_regs",
        EMBED_MODEL: "nlpai-lab/KURE-v1",
        RAG_MODEL_ID: "kei-admin-rag",
        RAG_TOPK: "5",
        HF_HUB_OFFLINE: "1",
        OLLAMA_KEEP_ALIVE: "-1",
        OLLAMA_PING_SECONDS: "240",
        // 리랭커 on(2026-07-15): GPU1 여유 확인(3.1/24GB) — 프로덕션과 동일 순위로 dev 테스트.
        // ⚠ GPU는 공유·변동적 — OOM으로 매 질의 밀집 강등·로그 스팸이 보이면 다시 "0"으로.
        RAG_RERANK: "1",
        RAG_RERANK_DEVICE: "cuda:1",
        APP_DB: "/home/mhchoi/kei-dev-0703/tools/app.db", // 격리 채팅DB(신규)
        APP_SECRET_FILE: "/home/mhchoi/kei-dev-0703/tools/.app_secret", // 격리 세션키(신규)
        APP_ADMINS: "21963,admintest,mhchoi@kei.re.kr", // admintest = dev 전용(prod 병합 시 제거) · mhchoi@ = 운영자 본계정
        // SMTP(실메일 발송): 방화벽 개방 후 아래 주석 해제 — 이 서버(192.168.1.104)→spam.kei.re.kr:25
        // 현재 사내 방화벽이 25/587/465 전부 차단(2026-07-13 실측) → 전산 담당 릴레이 허용 요청 필요.
        // SMTP_HOST: "spam.kei.re.kr",
        // SMTP_PORT: "25",
        // SMTP_FROM: "kei-admin-llm@kei.re.kr",
        VAULT_DIR: "/home/mhchoi/kei-dev-0703/KEI-행정가이드", // dev 전용 볼트(표 복원·docdata 소비)
        // 가입 정책(docs/29 §3): dev는 SMTP 없이 인증 코드를 응답에 동봉해 E2E 가능.
        // ⛔ 운영(prod) 병합 시 이 변수는 절대 켜지 말 것 — 대신 SMTP_HOST/PORT/FROM 설정.
        APP_DEV_ECHO_CODE: "1",
        APP_REG_RL_MAX: "100", // docs/44: 가입 RL(기본 10/시간) — dev는 E2E 스위트가 소진하지 않게 완화. 공개 배포 시 제거(기본 10)
        PYTHONUNBUFFERED: "1",
      },
    },
    {
      // 제보 자동 분석(docs/51 §5·6) — 매시 5분에 1회 실행 후 종료(autorestart:false).
      // 신규 제보 0건이면 LLM 호출 없이 run_log에 '없음'만 기록. ⛔ 볼트·검수상태 불변(계획·알림만).
      name: "kei-feedback-analyzer-dev",
      script: "/KEIAdminSuperv/tools/.venv/bin/python", // venv 공유(절대경로)
      args: "feedback_analyze.py",
      interpreter: "none",
      cwd: "/home/mhchoi/kei-dev-0703/tools",
      instances: 1,
      exec_mode: "fork",
      autorestart: false, // 1회 실행 후 종료 — cron_restart가 다음 시각에 다시 띄움
      cron_restart: "5 * * * *", // 매시 5분
      watch: false,
      env: {
        VLLM_BASE: "http://127.0.0.1:11436/v1", // kei-rag-api-dev와 동일 LLM 스택
        LLM_MODEL: "hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M",
        APP_DB: "/home/mhchoi/kei-dev-0703/tools/app.db",
        // SMTP_URL: "smtp://user:pass@spam.kei.re.kr:25?to=mhchoi@kei.re.kr", // 방화벽 개방 시(§5-6)
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
