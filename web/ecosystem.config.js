/**
 * PM2 프로세스 정의 — KEI 행정 가이드 [뇌] 정적 사이트.
 *
 * 사용:
 *   cd /KEIAdminSuperv/web
 *   pm2 start ecosystem.config.js     # 등록/기동
 *   pm2 save                          # 프로세스 목록 영속화
 *   pm2 logs kei-guide                # 로그 확인
 *   pm2 reload kei-guide              # 무중단 재시작
 *
 * 콘텐츠 갱신(볼트 → 사이트) 절차:
 *   VAULT_DIR=/KEIAdminSuperv/KEI-행정가이드 npm run build   # out/ 재생성
 *   pm2 reload kei-guide
 *
 * 보안: 사내망 서빙. 인터넷 공개는 nginx@127.0.0.1 + Cloudflare ZT 경유만 허용.
 */
module.exports = {
  apps: [
    {
      name: "kei-guide",
      script: "server.js",
      cwd: "/KEIAdminSuperv/web",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      watch: false,
      env: {
        HOST: "0.0.0.0",
        PORT: "3100",
      },
    },
  ],
};
