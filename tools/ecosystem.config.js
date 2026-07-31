/**
 * PM2 프로세스 정의 — KEI 행정 LLM RAG API (OpenAI 호환).
 *
 * 04_rag_api.py 를 uvicorn으로 띄운다. 127.0.0.1 전용(외부 비노출):
 * 정적 프론트(server.js)가 /api/rag/* 를 이 포트로 프록시한다.
 *
 * 사용:
 *   pm2 start /KEIAdminSuperv/tools/ecosystem.config.js
 *   pm2 save
 *   pm2 logs kei-rag-api
 *
 * 검색=Chroma(KURE-v1), 생성=격리 Ollama v0.31.1(Qwen3.5-9B, 127.0.0.1:11436). vLLM 아님.
 *  - 공유 Ollama(11434, v0.24.0)는 qwen3_5 아키텍처 미지원 → 전용 v0.31.1 사용(ecosystem.ollama-v031).
 *  - rag_core가 reasoning_effort:none(+think:false)로 사고 off + 공백결함 정규화(모델명 qwen3.5 자동 감지).
 *  - 롤백: VLLM_BASE→11434, LLM_MODEL→hf.co/Qwen/Qwen3-14B-GGUF:Q4_K_M 후 config 경로로 pm2 restart.
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
        VLLM_BASE: "http://127.0.0.1:11436/v1", // 격리 Ollama v0.31.1 (kei-ollama-v031)
        // Qwen3.5-9B(GGUF Q4_K_M, unsloth). Ollama 레지스트리 차단 → hf.co/ 로 pull.
        // 선정 근거: 487문항 감사 + 25문항 동일근거 A/B에서 값정확도 우위(57.3% vs 40.8%). docs/15 참조.
        LLM_MODEL: "hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M",
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
        // 기능 플래그 관리자(쉼표 구분 아이디). 여기 등록된 계정만 /admin에서 토글 가능.
        // ⚠ fail-closed: 미설정이면 아무도 관리자 아님. 실계정(이메일)은 git에 안 남기게
        // 아래 로컬 오버라이드(ecosystem.local.js, gitignore)로 지정한다.
        //
        // ⛔ 커밋본은 **비워 둔다**(2026-07-29, 운영자 지시로 자리표시자 "21963" 제거).
        //    자리표시자를 남기면 ⓐ 로컬 오버라이드가 없는 환경에서 '누가 관리자인가'가 모호해지고
        //    ⓑ 실계정 이메일로 바꾸고 싶은 유혹을 만든다 — 공개 레포에 개인 주소가 남는다.
        //    운영 관리자(mhchoi@kei.re.kr)는 ecosystem.local.js(gitignore)에만 둔다.
        APP_ADMINS: "",
        PYTHONUNBUFFERED: "1", // print/로그 즉시 flush(PM2 로그 가시성)

        // ── 운영자 알림(Slack) — 정책 정본 docs/66 ──────────────────────────
        // ⛔ 봇 토큰은 시크릿이다. APP_ADMINS와 같은 이유로 커밋본은 **비워 둔다**
        //    → 미설정 = 발송 안 함(fail-safe). 실제 토큰은 ecosystem.local.js(gitignore)에만.
        // ⚠ 사내 방화벽이 TLS SNI로 **맨 slack.com만** 끊는다. www.slack.com(=공식 slack_sdk의
        //   기본 base URL)·api.slack.com은 열려 있어 chat.postMessage가 정상 동작한다.
        //   그래서 SLACK_API_BASE 기본값이 www.slack.com이다(2026-07-30 실측, docs/66 §5.1).
        SLACK_BOT_TOKEN: "",
        SLACK_CHANNEL: "#horong",
        ALERT_MIN_SEV: "3", // 3=전부 / 2=SEV3(일일 다이제스트) 조용
        ALERT_MAX_PER_DAY: "50", // 폭주 시 채널 보호 상한

        // 로컬 오버라이드(선택): tools/ecosystem.local.js 가 있으면 env를 덮어씀.
        // 예) module.exports = { APP_ADMINS: "…", SLACK_BOT_TOKEN: "xoxb-…" };
        ...(function () { try { return require("./ecosystem.local.js"); } catch { return {}; } })(),
      },
    },
  ],
};
