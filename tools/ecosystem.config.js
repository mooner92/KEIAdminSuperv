/**
 * ⛔ 폐기(2026-10-08 역할 교체) — 이 파일로 기동하지 마세요.
 *
 *   운영(배포) 3101 → deploy/ecosystem.prod.config.js   (작업트리 /home/mhchoi/kei-dev-0703, 브랜치 main)
 *   테스트     3100 → deploy/ecosystem.test.config.js   (작업트리 /KEIAdminSuperv, 브랜치 dev)
 *
 * 사용자에게 공유된 링크가 3101이라 3101을 운영으로 바꿨다(docs/60 §5). 옛 이름으로 띄우면 같은 포트를
 * 두 프로세스가 다투거나 운영 데이터를 테스트 설정으로 여는 사고가 나므로, 기동 자체를 막는다.
 */
throw new Error("폐기된 PM2 설정입니다 — deploy/ecosystem.prod.config.js(3101 운영) 또는 deploy/ecosystem.test.config.js(3100 테스트)를 쓰세요.");
