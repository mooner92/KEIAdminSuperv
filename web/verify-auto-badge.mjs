// 자동첨부(🔗)·일부반영 배지 실렌더 검증 (dev 3101):
// 국내출장 정산 질의 → 기안 자동첨부 근거에 '🔗 자동첨부' 배지(source_type_badges 게이트).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const USER = "autobadge";
const PW = "test1234";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const ctx = await b.newContext();
let r = await ctx.request.post(`${BASE}/api/app/auth/register`, { data: { username: USER, password: PW } });
if (!r.ok()) r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: USER, password: PW } });
ok(r.ok(), `0) 로그인 (${r.status()})`);

const flags = await (await ctx.request.get(`${BASE}/api/app/flags`)).json();
ok(flags.source_type_badges === true, "1) source_type_badges 플래그 on(배지 게이트)");

const p = await ctx.newPage({ viewport: { width: 1400, height: 1200 } });
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(1200);
await p.click('button:has-text("새 대화")').catch(() => {});
await p.waitForTimeout(400);
await p.fill('textarea[placeholder^="행정 업무"]', "국내출장 여비 정산 어떻게 하나요?");
await p.click('button:has-text("보내기")');
await p.waitForSelector('button[title="도움이 됐어요"]', { timeout: 240000 }).catch(() => {});
await p.waitForTimeout(1500);

const aside = p.locator("aside");
const autoBadge = await aside.getByText("🔗 자동첨부").count();
ok(autoBadge > 0, `2) 근거 카드 '🔗 자동첨부' 배지 노출 (${autoBadge}개)`);
// 자동첨부 배지의 tooltip이 종류를 설명하는지(기안/별표/준용/후속 중 하나)
const title = await aside.locator(`[title*="자동으로 함께 가져왔어요"]`).first().getAttribute("title");
ok(!!title, `3) 배지 tooltip 설명 존재 (${(title || "").slice(0, 24)}…)`);

await aside.screenshot({ path: "verify-auto-badge.png" }).catch(() => {});
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 자동첨부 배지 검증 통과");
process.exit(fails.length ? 1 : 0);
