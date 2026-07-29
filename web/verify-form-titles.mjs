// PMS 표시명 정리(영문 런온 제거) + DOCX 분량 배지 검증 (dev 3101).
import { chromium } from "playwright";

// ⛔ 테스트 계정 비밀번호를 코드에 두지 않는다(보안 스캔 후속 — dev 계정 14개가
//    레포에 박힌 비밀번호로 열리던 것을 2026-07-29에 회전).
//    실행: set -a; . tools/.test_credentials; set +a; node <이 파일>
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — tools/.test_credentials 를 로드하세요.");
  process.exit(2);
}
const BASE = "http://localhost:3101";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1160, height: 700 } });
await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: TEST_PW } });
await ctx.route("**/app/flags**", (r) => r.fulfill({ contentType:"application/json", body: JSON.stringify({ forms_registry: true }) }));
const p = await ctx.newPage();
await p.goto(`${BASE}/forms/`, { waitUntil: "networkidle" });
await p.waitForSelector("table tbody tr");
await p.fill('input[aria-label="서식 검색"]', "연구윤리준수확인서");
await p.waitForTimeout(700);
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/forms-fixed.png" });
console.log("캡처 완료");
await b.close();
