// 서식 찾기 분량 배지 검증 — '한 장'(1쪽)/'N장'(다쪽) (dev 3101). forms_registry는 route로 강제 on.
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1240, height: 1500 } });
const r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: "test1234" } });
console.log("로그인:", r.status());
await ctx.route("**/app/flags**", (route) =>
  route.fulfill({ contentType: "application/json", body: JSON.stringify({ forms_registry: true }) }));
const p = await ctx.newPage();
await p.goto(`${BASE}/forms/`, { waitUntil: "networkidle" });
await p.waitForSelector("table tbody tr", { timeout: 10000 });
const one = await p.locator("tbody span").filter({ hasText: /^1\.p$/ }).count();
const spill = await p.locator("tbody span").filter({ hasText: /^≈1\.p$/ }).count();
const many = await p.locator("tbody span").filter({ hasText: /^\d+\.p$/ }).count();
console.log(`✓ 표 렌더 · '1.p'(한 장) ${one} · '≈1.p'(꼬리넘침) ${spill} · 'N.p'(다쪽) ${many}`);
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/forms-byeolji.png" });
// 꼬리넘침 표본: 직인관리규정 별지 제2호(직인사용기록부) — ≈1 초록 배지여야
await p.fill('input[aria-label="서식 검색"]', "직인관리");
await p.waitForTimeout(500);
const spillBadge = p.locator("tbody span").filter({ hasText: /^≈1\.p$/ }).first();
const spillCnt = await p.locator("tbody span").filter({ hasText: /^≈1\.p$/ }).count();
const tip = spillCnt ? await spillBadge.getAttribute("title") : "(없음)";
// 초록(pages1) 클래스 확인 — 색상 토큰이 아니라 클래스명으로 판정
const cls = spillCnt ? await spillBadge.getAttribute("class") : "";
console.log(`✓ '직인관리' 필터 · ≈1 배지 ${spillCnt}건 · title="${tip}"`);
console.log(`  배지 클래스(초록 pages1 포함?): ${/pages1/.test(cls || "")}`);
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/forms-spill.png" });
if (!spillCnt || !/pages1/.test(cls || "")) { console.error("❌ 꼬리넘침 ≈1 초록 배지 검증 실패"); process.exit(1); }
console.log("🎉 꼬리넘침 배지 검증 통과");
await b.close();
