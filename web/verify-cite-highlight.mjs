// cite_highlight 플래그 end-to-end: OFF=하이라이트·배지 없음 / ON=인용 블록 형광 + ⭐핵심근거.
// 사용: node verify-cite-highlight.mjs off|on   (bash가 플래그 토글하며 2회 실행)
import { chromium } from "playwright";

const BASE = "http://localhost:3100";
const USER = "fb_test";
const PW = "test1234";
const MODE = process.argv[2] === "on" ? "on" : "off";
const expectOn = MODE === "on";
const fails = [];
const ok = (c, m) => {
  console.log((c ? "✅ " : "❌ ") + m);
  if (!c) fails.push(m);
};

const b = await chromium.launch();
const ctx = await b.newContext();
let r = await ctx.request.post(`${BASE}/api/app/auth/register`, { data: { username: USER, password: PW } });
if (r.status() === 409) r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: USER, password: PW } });
ok(r.ok(), `0) 로그인 (${r.status()})`);

const p = await ctx.newPage();
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(1600);

// 페이지가 받은 플래그 값이 모드와 일치하는지
const flag = await p.evaluate(async () => {
  try {
    const r = await fetch("/api/app/flags");
    return (await r.json()).cite_highlight;
  } catch {
    return null;
  }
});
ok(flag === expectOn, `1) cite_highlight=${flag} (기대 ${expectOn})`);

await p.click('button:has-text("새 대화")').catch(() => {});
await p.waitForTimeout(400);
// ⭐ 핵심 근거가 '가이드'(조='') 인 시나리오로 검증 — 앵커 없는 출처의 텍스트 매칭 하이라이트
await p.fill('textarea[placeholder^="행정 업무"]', "출장 여비는 어떻게 정산하나요?");
await p.click('button:has-text("보내기")');
await p.waitForSelector('button[title="도움이 됐어요"]', { timeout: 90000 }).catch(() => {});
await p.waitForTimeout(900);

const sources = p.locator('aside:has-text("근거 조문")');
// ⭐ 핵심 근거 배지 (ON에서만)
const badge = await sources.getByText("핵심 근거").count();
ok(expectOn ? badge > 0 : badge === 0, `2) ⭐핵심근거 배지=${badge} (기대 ${expectOn ? "있음" : "없음"})`);

// 첫 근거 카드 클릭 → 드로어 열림
await sources.locator("button").first().click();
await p.waitForSelector('[role="dialog"] h1', { timeout: 8000 }).catch(() => {});
await p.waitForTimeout(1500);
const drawerOpen = await p.locator('[role="dialog"] h1').count();
ok(drawerOpen > 0, "3) 문서 드로어 열림");

// 인용 블록 하이라이트 (ON에서만)
const cited = await p.locator('[role="dialog"] [class*="cited"]').count();
ok(expectOn ? cited > 0 : cited === 0, `4) 인용 블록 형광=${cited} (기대 ${expectOn ? "있음" : "없음"})`);

await p.screenshot({ path: `verify-cite-${MODE}.png`, fullPage: false });
await b.close();
console.log(fails.length ? `\n❌ [${MODE}] ` + fails.join(" / ") : `\n✅ [${MODE}] cite_highlight 검증 통과`);
process.exit(fails.length ? 1 : 0);
