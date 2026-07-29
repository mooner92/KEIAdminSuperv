// 품질 게시판 추이 분리 검증(2026-07-25) — 메인 7일 + 전체 이력 페이지(PagedList+DataTable).
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
const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
console.log("로그인:", (await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: TEST_PW } })).status());
await ctx.route("**/app/flags**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ quality_board: true }) }));
const p = await ctx.newPage();
await p.goto(`${BASE}/quality/`, { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
const mainRows = await p.locator('[class*="DataTable_table"] tbody tr').count();
const link = await p.getByText("모든 테스트 결과 보기", { exact: false }).count();
console.log(`  메인: 추이 행 ${mainRows}(≤7) · 전체보기 링크 ${link}`);
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/quality-main.png" });
await p.goto(`${BASE}/quality/trend/`, { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
const allRows = await p.locator('[class*="DataTable_table"] tbody tr').count();
const paged = await p.locator('[class*="PagedList_controls"]').count();
console.log(`  전체 이력: 행 ${allRows} · PagedList 컨트롤 ${paged}`);
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/quality-trend.png" });
if (mainRows > 7 || !paged) { console.error("❌ 검증 실패"); process.exit(1); }
console.log("🎉 추이 분리 검증 통과");
await b.close();
