// 목록형 3화면(문서·서식·결재선) 컴포넌트 통일 검증 (사용자 지시 2026-07-25)
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
console.log("로그인:", (await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: "test1234" } })).status());
await ctx.route("**/app/flags**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ forms_registry: true, approval_finder: true, content_search: true, explore_upgrades: true }) }));
const p = await ctx.newPage();
const shots = [
  ["문서", `${BASE}/browse/?tab=docs`, "browse-docs"],
  ["서식", `${BASE}/browse/?tab=forms`, "browse-forms"],
  ["결재선", `${BASE}/approval/`, "browse-approval"],
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
