// 개정 영향 분석(/impact) 실렌더 검증 — specs/05 D2 (공용 컴포넌트·드로어·실사례).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 950 } });
console.log("로그인:", (await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: "test1234" } })).status());
await ctx.route("**/app/flags**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ impact_analysis: true, graph_impact: true }) }));
const p = await ctx.newPage();
await p.goto(`${BASE}/impact/`, { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
const rows = await p.locator('[class*="BrowseUI_row"]').count();
const groups = await p.locator('[class*="BrowseUI_groupTitle"]').count();
console.log(`  목록: 공용 행 ${rows} · 필터그룹 ${groups}`);
// 실사례: 인사규정 제31조 → direct에 보수규정
const si = p.locator('input[aria-label="조문 검색"]');
await si.fill("인사규정 제31조");
await p.waitForTimeout(700);
const hit = await p.getByText("보수규정", { exact: false }).count();
console.log(`  '인사규정 제31조' 검색 → 보수규정 파급 표시: ${hit > 0 ? "✅" : "❌"}`);
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/impact-page.png" });
// 파급 링크 → 드로어
const link = p.locator('[class*="Impact_link"]').first();
await link.click();
await p.waitForTimeout(1500);
const drawer = await p.locator('[class*="DocDrawer_panel"], aside[role="dialog"]').count();
console.log(`  파급 링크 → 문서 드로어: ${drawer > 0 ? "✅" : "❌"}`);
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/impact-drawer.png" });
if (!rows || !hit || !drawer) { console.error("❌ 실패"); process.exit(1); }
console.log("🎉 /impact 검증 통과");
await b.close();
