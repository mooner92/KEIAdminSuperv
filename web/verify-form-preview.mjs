// 서식 미리보기 사이드패널 검증(2026-07-25 사용자 요청)
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
console.log("로그인:", (await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: "test1234" } })).status());
await ctx.route("**/app/flags**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ forms_registry: true }) }));
const p = await ctx.newPage();
await p.goto(`${BASE}/browse/?tab=forms`, { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
const before = p.url();
// 서식명 클릭 → 패널
await p.locator('[class*="Forms_titleBtn"]').first().click();
await p.waitForTimeout(1200);
const open = await p.locator('[class*="SideDrawer_overlay"][class*="SideDrawer_open"]').count();
const frame = await p.locator('iframe[title*="미리보기"]').count();
const dl = await p.locator('[class*="FormPreviewDrawer_dl"]').count();
const origin = await p.locator('[class*="FormPreviewDrawer_origin"]').count();
console.log(`  패널 열림 ${open} · PDF iframe ${frame} · 다운로드 ${dl} · 원문 링크 ${origin} · URL 유지 ${p.url() === before}`);
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/form-preview.png" });
// Esc로 닫힘
await p.keyboard.press("Escape");
await p.waitForTimeout(600);
const closed = await p.locator('[class*="SideDrawer_overlay"][class*="SideDrawer_open"]').count();
console.log(`  Esc 닫힘: ${closed === 0}`);
if (!open || !frame || !dl || closed !== 0) { console.error("❌ 실패"); process.exit(1); }
console.log("🎉 미리보기 패널 검증 통과");
await b.close();
