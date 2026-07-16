// 출처 성격 배지(source_type_badges) 실렌더 검증 (dev 3101):
// 여비 질의 → 근거 패널에 📘 가이드(레시피 노트) + 📜 규정(여비규정) 동시 노출.
import { chromium } from "playwright";

const BASE = "http://localhost:3101"; // ⛔ dev만. prod(3100) 미사용.
const USER = "badgetest";
const PW = "test1234";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const ctx = await b.newContext();
let r = await ctx.request.post(`${BASE}/api/app/auth/register`, { data: { username: USER, password: PW } });
if (!r.ok()) r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: USER, password: PW } });
ok(r.ok(), `0) 로그인 (${r.status()})`);

const p = await ctx.newPage({ viewport: { width: 1400, height: 1200 } });
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(1200);
await p.click('button:has-text("새 대화")').catch(() => {});
await p.waitForTimeout(400);
await p.fill('textarea[placeholder^="행정 업무"]', "부연구위원이 세종에서 서울로 1일 출장 가면 여비 얼마야?");
await p.click('button[aria-label="보내기"]');

// A/B가 Ollama 점유 중 → 답변 대기 넉넉히(최대 240s)
await p.waitForSelector('button[title="도움이 됐어요"]', { timeout: 240000 }).catch(() => {});
await p.waitForTimeout(1500);

const aside = p.locator("aside");
const guideBadge = await aside.getByText("📘 가이드", { exact: false }).count();
const regBadge = await aside.getByText("📜 규정", { exact: false }).count();
ok(guideBadge > 0, `1) 근거 패널 📘 가이드 배지 노출 (${guideBadge})`);
ok(regBadge > 0, `2) 근거 패널 📜 규정 배지 노출 (${regBadge})`);

await p.locator("aside").screenshot({ path: "verify-source-badges.png" }).catch(async () => {
  await p.screenshot({ path: "verify-source-badges.png", fullPage: false });
});
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 출처 성격 배지 검증 통과");
process.exit(fails.length ? 1 : 0);
