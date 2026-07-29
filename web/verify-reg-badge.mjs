// 📜 규정 배지 검증(dev 3101): 규정 원문을 회수하는 질의로 regChip 확인.
import { chromium } from "playwright";

// ⛔ 테스트 계정 비밀번호를 코드에 두지 않는다(보안 스캔 후속 — dev 계정 14개가
//    레포에 박힌 비밀번호로 열리던 것을 2026-07-29에 회전).
//    실행: set -a; . tools/.test_credentials; set +a; node <이 파일>
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — tools/.test_credentials 를 로드하세요.");
  process.exit(2);
}
const BASE = "http://localhost:3101";
const USER = "badgetest", PW = TEST_PW;
const b = await chromium.launch();
const ctx = await b.newContext();
let r = await ctx.request.post(`${BASE}/api/app/auth/register`, { data: { username: USER, password: PW } });
if (!r.ok()) r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: USER, password: PW } });
const p = await ctx.newPage({ viewport: { width: 1400, height: 1200 } });
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(1000);
await p.click('button:has-text("새 대화")').catch(() => {});
await p.waitForTimeout(400);
await p.fill('textarea[placeholder^="행정 업무"]', "직원 징계의 종류에는 어떤 것들이 있나요?");
await p.click('button[aria-label="보내기"]');
await p.waitForSelector('button[title="도움이 됐어요"]', { timeout: 240000 }).catch(() => {});
await p.waitForTimeout(1500);
const aside = p.locator("aside");
const reg = await aside.getByText("📜 규정", { exact: false }).count();
const guide = await aside.getByText("📘 가이드", { exact: false }).count();
console.log(`📜 규정 배지: ${reg} · 📘 가이드 배지: ${guide}`);
await aside.screenshot({ path: "verify-reg-badge.png" }).catch(() => {});
await b.close();
console.log(reg > 0 ? "✅ 규정 배지 검증 통과" : "❌ 규정 배지 미노출");
process.exit(reg > 0 ? 0 : 1);
