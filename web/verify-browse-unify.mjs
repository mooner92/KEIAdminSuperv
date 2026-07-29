// 목록형 3화면(문서·서식·결재선) 컴포넌트 통일 검증 (사용자 지시 2026-07-25)
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
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
console.log("로그인:", (await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: TEST_PW } })).status());
await ctx.route("**/app/flags**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ forms_registry: true, approval_finder: true, content_search: true, explore_upgrades: true, deadline_calc: true, deadlines_hub: true }) }));
const p = await ctx.newPage();
const shots = [
  ["문서", `${BASE}/browse/?tab=docs`, "browse-docs"],
  ["서식", `${BASE}/browse/?tab=forms`, "browse-forms"],
  ["결재선", `${BASE}/approval/`, "browse-approval"],
  ["기한사전", `${BASE}/deadlines/`, "browse-deadlines"],
];
for (const [name, url, file] of shots) {
  await p.goto(url, { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  // 공용 스킨 클래스가 실제로 적용됐는지(해시된 모듈명이라 접두 매칭)
  const rows = await p.locator('[class*="BrowseUI_row"]').count();
  const groups = await p.locator('[class*="BrowseUI_group"]').count();
  const checks = await p.locator('[class*="BrowseUI_hrCheck"]').count();
  console.log(`${name}: 공용 행 ${rows} · 필터그룹 ${groups} · 공용체크 ${checks}`);
  await p.screenshot({ path: `/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/${file}.png` });
}
await b.close();
