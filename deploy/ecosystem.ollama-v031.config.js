/**
 * PM2 — 격리 Ollama v0.31.1 (KEI LLM 전용 백엔드, 127.0.0.1:11436).
 *
 * 왜 별도 인스턴스인가:
 *  - 공유 Ollama(jhkim, 127.0.0.1:11434, v0.24.0)는 qwen3_5 아키텍처를 로드하지 못한다(실측).
 *  - Qwen3.5-9B 서빙에는 최신 런타임이 필요해, mhchoi 홈에 v0.31.1을 받아 별도 포트로 돌린다.
 *  - 공유 인스턴스(11434)는 건드리지 않는다. 모델 저장소도 분리(OLLAMA_MODELS).
 *
 * ⚠ NVIDIA 드라이버 535 < 550(신규 CUDA 요구) → v0.31.1은 CUDA 대신 Vulkan으로 GPU를 쓴다.
 *   느리지만 동작(9B Q4는 카드 1장에 여유). 드라이버 550+ 업그레이드 시 CUDA로 자동 전환되어 빨라진다.
 *
 * 사용:
 *   pm2 start /KEIAdminSuperv/deploy/ecosystem.ollama-v031.config.js && pm2 save
 * 모델 재풀(필요시): OLLAMA_HOST=127.0.0.1:11436 /home/mhchoi/ollama-latest/bin/ollama pull hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M
 */
module.exports = {
  apps: [
    {
      name: "kei-ollama-v031",
      script: "/home/mhchoi/ollama-latest/bin/ollama",
      args: "serve",
      interpreter: "none",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      watch: false,
      env: {
        OLLAMA_HOST: "127.0.0.1:11436", // 11434=jhkim 0.24.0(불변), 11435=타 인스턴스 점유 → 11436
        OLLAMA_MODELS: "/home/mhchoi/.ollama-test/models", // 격리 모델 저장소(qwen3.5 GGUF)
        // qwen3.5 네이티브 컨텍스트(262K)를 그대로 두면 KV캐시가 10GB+ 폭증 → RAG에 충분한 8K로 제한.
        // (근거 top-5 + 멀티턴 재생 합쳐도 8K면 여유. 16.3GB→~8GB로 축소, GPU 1장 상주 보장)
        OLLAMA_CONTEXT_LENGTH: "8192",
        LD_LIBRARY_PATH: "/home/mhchoi/ollama-latest/lib/ollama", // 동봉 CUDA/Vulkan 라이브러리
      },
    },
  ],
};
