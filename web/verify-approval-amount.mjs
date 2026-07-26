// 결재선 금액 판정(specs/06 D2) — 로직 유닛 + 실렌더 검증.
// ① lib/amountRules 순수 함수(경계값·파서·포맷) ② 화면(금액 입력→구간 필터→근거 표시)
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

// ── ① 로직 유닛: 서버 산출 amount_rules.json으로 직접 판정 ──
const RULES = JSON.parse(readFileSync("../tools/index/amount_rules.json", "utf-8")).rules;
const covers = (r, w) =>
  !(r.min !== null && (w < r.min || (w === r.min && !r.min_incl))) &&
  !(r.max !== null && (w > r.max || (w === r.max && !r.max_incl)));
const findRange = (key, w) => (RULES[key]?.구간 || []).find((g) => covers(g, w));
const KGAJI = "3.예산집행 > 가.원인행위 > 1) 가지급금집행";
let bad = 0;
const unit = (label, got, want) => { const ok = got === want; bad += !ok; console.log(`  ${ok ? "✅" : "❌"} ${label}: ${got} (기대 ${want})`); };
console.log("① 로직 유닛(경계값)");
unit("2,000,000원(이하 포함)", findRange(KGAJI, 2_000_000)?.전결권자, "실･팀장");
unit("2,000,001원(초과)", findRange(KGAJI, 2_000_001)?.전결권자, "부서장/센터장");
unit("3,700,000원", findRange(KGAJI, 3_700_000)?.전결권자, "부서장/센터장");
unit("30,000,001원(상한 개방)", findRange(KGAJI, 30_000_001)?.전결권자, "원장");

// ── ② 실렌더 ──
console.log("② 실렌더");
const BASE = "http://localhost:3101";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 950 } });
console.log("  로그인:", (await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: "test1234" } })).status());
await ctx.route("**/app/flags**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ approval_finder: true, explore_upgrades: true }) }));
const p = await ctx.newPage();
await p.goto(`${BASE}/approval/`, { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
const before = parseInt((await p.locator('[class*="PagedList_count"]').first().innerText()).replace(/[^\d]/g, ""), 10);
// 금액 입력
await p.locator('input[aria-label="금액으로 좁히기"]').fill("370만");
await p.waitForTimeout(900);
const echo = await p.locator('[class*="AmountInput_echo"]').innerText();
const after = parseInt((await p.locator('[class*="PagedList_count"]').first().innerText()).replace(/[^\d]/g, ""), 10);
const reasons = await p.locator('[class*="AmountReason_badge"]').count();
const src = await p.locator('[class*="AmountReason_src"]').count();
console.log(`  해석 표시: ${echo} · 건수 ${before}→${after} · 근거 배지 ${reasons} · 별표 원문행 ${src}`);
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/approval-amount.png" });
// 가지급금 검색으로 좁혀 정확 판정 확인
await p.locator('input[aria-label="업무 검색"]').fill("가지급금");
await p.waitForTimeout(900);
const txt = await p.locator('[class*="BrowseUI_row"]').first().innerText();
const okOwner = /부서장|센터장/.test(txt);
console.log(`  가지급금 370만원 → 첫 행에 부서장/센터장: ${okOwner ? "✅" : "❌"}`);
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/approval-amount-2.png" });
await b.close();
if (!echo.includes("3,700,000") || after >= before || !reasons || !src || !okOwner) { console.error("❌ 실패"); process.exit(1); }
console.log(bad ? `⚠ 유닛 ${bad}건 실패` : "🎉 금액 판정 화면 검증 통과");
process.exit(bad ? 1 : 0);
