// 관리자 사용자 탭 — 실사용자/테스트 분리 회귀(2026-07-28 사용자 지시).
// 관리자 계정 없이 돌도록 /auth/me·/flags·/users를 스텁하고 분류 규칙만 검증한다.
import { chromium } from "playwright";
const OUT = "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await ctx.request.post("http://localhost:3101/api/app/auth/login", { data: { username: "b6test", password: "test1234" } });
await ctx.route("**/app/auth/me", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ id: 1, username: "b6test", is_admin: true }) }));
await ctx.route("**/app/flags**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ user_directory: true }) }));
const users = [
  { id: 1, username: "khchoi@kei.re.kr", created_at: 1785000000, last_active: 1785000000, chats: 24, verified: true },
  { id: 2, username: "yjkim@kei.re.kr", created_at: 1784900000, last_active: 1784900000, chats: 2, verified: true },
  { id: 3, username: "dyjin@kei.re.kr", created_at: 1784900000, last_active: 1785100000, chats: 1, verified: true },
  { id: 4, username: "ljm@kei.re.kr", created_at: 1784800000, last_active: null, chats: 0, verified: true },
  { id: 5, username: "mhchoi@kei.re.kr", created_at: 1784700000, last_active: 1785100000, chats: 9, verified: true, is_admin: true },
  { id: 6, username: "fb_test", created_at: 1784600000, last_active: null, chats: 10, verified: true },
  { id: 7, username: "apprtest_1784165009207@kei.re.kr", created_at: 1784600000, last_active: null, chats: 0, verified: true },
  { id: 8, username: "b6test", created_at: 1784500000, last_active: null, chats: 3, verified: true },
  { id: 9, username: "test12@kei.re.kr", created_at: 1784500000, last_active: null, chats: 0, verified: true },
];
await ctx.route("**/app/users**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ users }) }));
const p = await ctx.newPage();
await p.goto("http://localhost:3101/admin/", { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
const tab = p.locator('button:has-text("사용자")').first();
if (await tab.count()) { await tab.click(); await p.waitForTimeout(1600); }
let fail = 0;
const segs = await p.locator('[class*="Admin_segBtn"]').allTextContents();
console.log("세그먼트:", segs);
const rowsReal = await p.locator("tbody tr").count();
console.log(`기본(실사용자) 행: ${rowsReal} ${rowsReal === 5 ? "✅" : "❌ 기대 5"}`);
if (rowsReal !== 5) fail++;
await p.screenshot({ path: `${OUT}/users-real.png` });
await p.locator('button:has-text("테스트")').first().click();
await p.waitForTimeout(900);
const rowsTest = await p.locator("tbody tr").count();
const badges = await p.locator('[class*="Admin_badgeTest"]').count();
console.log(`테스트 행: ${rowsTest} · 배지 ${badges} ${rowsTest === 4 && badges === 4 ? "✅" : "❌ 기대 4"}`);
if (rowsTest !== 4) fail++;
await p.screenshot({ path: `${OUT}/users-test.png` });
await b.close();
console.log(fail ? `⛔ ${fail}건` : "🎉 실사용자/테스트 분리 확인");
process.exit(fail ? 1 : 0);
