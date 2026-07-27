// 관리자 🛡 신뢰 탭 회귀(2026-07-28 사용자 제보 3건) — 근거 칩 드로어 전환·잘림·히트포인트.
// ⚠ 관리자 계정 없이 돌 수 있게 /auth/me·/flags·/trust를 스텁한다(컴포넌트 계약만 검증).
import { chromium } from "playwright";
const OUT = "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await ctx.request.post("http://localhost:3101/api/app/auth/login", { data: { username: "b6test", password: "test1234" } });
await ctx.route("**/app/auth/me", (r) => r.fulfill({ contentType: "application/json",
  body: JSON.stringify({ id: 1, username: "b6test", is_admin: true }) }));
await ctx.route("**/app/flags**", (r) => r.fulfill({ contentType: "application/json",
  body: JSON.stringify({ trust_ops: true }) }));
const 근거 = (n) => Array.from({ length: n }, (_, i) => ({
  규정명: `국내출장 여비 — 얼마 나오나 (계산 가이드) ${i + 1}. 정산`, 조: `제${10 + i}조`,
  검수상태: i % 2 ? "검수완료" : "미검수", slug: "4300_여비규정" }));
await ctx.route("**/app/trust**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({
  radar: Array.from({ length: 6 }, (_, k) => ({ at: 1785000000 + k * 3600, 근거: 근거(5), n_unreviewed: 3 })),
  matrix: [{ 규정명: "여비규정", 인용수: 42, 검수상태: "미검수", down: 2, slug: "4300_여비규정" }],
  feedback_types: [{ 유형: "근거 부족", n: 3 }], feedback_reasons: [] }) }));
const p = await ctx.newPage();
await p.goto("http://localhost:3101/admin/", { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
const tab = p.locator('button:has-text("신뢰")').first();
if (await tab.count()) { await tab.click(); await p.waitForTimeout(1800); }
let fail = 0;
const chip = p.locator('button[class*="Admin_srcChip"]').first();
const n = await chip.count();
console.log("근거 칩(버튼):", n, n > 0 ? "✅" : "❌");
if (!n) fail++;
if (n) {
  const box = await chip.boundingBox();
  const ok = box.height >= 26;
  console.log(`히트 영역: ${Math.round(box.width)}×${Math.round(box.height)}px ${ok ? "✅" : "❌ (26px 미만)"}`);
  if (!ok) fail++;
  const clip = await p.evaluate(() => {
    const cell = document.querySelector('[class*="DataTable_wrapCell"]');
    if (!cell) return null;
    const cr = cell.getBoundingClientRect();
    return { over: [...cell.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > cr.right + 1).length,
             wrapped: getComputedStyle(cell).whiteSpace };
  });
  console.log("wrap 셀:", JSON.stringify(clip), clip && clip.over === 0 && clip.wrapped === "normal" ? "✅ 잘림 없음" : "❌");
  if (!(clip && clip.over === 0)) fail++;
  await p.screenshot({ path: `${OUT}/trust-before-click.png` });
  const before = p.url();
  await chip.click(); await p.waitForTimeout(1600);
  const drawer = await p.locator('[class*="DocDrawer_panel"]').count();
  const same = p.url() === before;
  console.log("드로어:", drawer > 0 ? "✅ 열림" : "❌", "· URL 유지:", same ? "✅" : "❌");
  if (!drawer || !same) fail++;
  await p.screenshot({ path: `${OUT}/trust-drawer.png` });
}
await b.close();
console.log(fail ? `⛔ ${fail}건` : "🎉 신뢰 탭 3건 수정 확인");
process.exit(fail ? 1 : 0);
