/**
 * PM2 — 에이전트 전용 Ollama(kei-ollama-agent, 127.0.0.1:11438). docs/74.
 *
 * ⚠ 11437은 다른 앱(tincase-ollama, 0.0.0.0:11437)이 점유 중이다 — 2026-10-06 처음 11437로 띄웠을 때
 *   bind 실패로 이 앱은 errored였고, 에이전트 요청이 tincase 인스턴스로 흘러갔다(같은 모델 디렉터리라
 *   조용히 동작해 발견이 늦었다). 포트를 바꿀 땐 `ss -ltn`으로 비어 있는지 먼저 확인하고,
 *   기동 후 `ss -ltnp | grep <port>`의 pid가 이 앱의 pid인지 대조한다.
 *
 * 왜 따로 띄우나(2026-10-06 실측): 서비스 Ollama(11436)는 러너를 **하나만** 상주시킨다.
 *   에이전트용 32K 별칭(kei-qwen35-agent)을 같은 인스턴스에 올리자 서비스 8K 러너가 축출됐고,
 *   다음 서비스 답변이 재적재로 106초 걸렸다(prod·dev 공유 — 운영 지연으로 번진다).
 *   → 인스턴스를 분리해 서로의 러너를 절대 건드리지 않게 한다. 모델 blob은 같은 디렉터리를 읽기만 한다.
 *
 * GPU: GPU1 고정(서비스 러너·외부 사용자와 겹침 최소화). 공유·변동적이라 배치 전 nvidia-smi 확인.
 * ⛔ 외부망 불필요(모델 pull 없음 — 별칭 매니페스트는 이미 OLLAMA_MODELS에 있다).
 *
 *   pm2 start /home/mhchoi/kei-dev-0703/deploy/ecosystem.agent-ollama.config.js
 */
module.exports = {
  apps: [
    {
      name: "kei-ollama-agent",
      script: "/home/mhchoi/ollama-latest/bin/ollama",
      args: "serve",
      interpreter: "none",
      cwd: "/home/mhchoi",
      autorestart: true,
      max_restarts: 10,
      watch: false,
      env: {
        OLLAMA_HOST: "127.0.0.1:11438",
        OLLAMA_MODELS: "/home/mhchoi/.ollama-test/models",
        OLLAMA_CONTEXT_LENGTH: "32768",
        OLLAMA_KEEP_ALIVE: "-1",
        OLLAMA_MAX_LOADED_MODELS: "1",
        // 슬롯 1(기본) — 2슬롯 실측: 동시 2요청 54.2s vs 단일 26.0s로 완전 직렬(Vulkan) → 이득 없음(docs/74 §6)
        OLLAMA_NUM_PARALLEL: "1",
        LD_LIBRARY_PATH: "/home/mhchoi/ollama-latest/lib/ollama",
        // 드라이버 535 → Vulkan 경로. 장치 고정은 두 백엔드 변수 모두(어느 쪽이 잡혀도 GPU1)
        GGML_VK_VISIBLE_DEVICES: "1",
        CUDA_VISIBLE_DEVICES: "1",
      },
    },
  ],
};
