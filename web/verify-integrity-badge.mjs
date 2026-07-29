// 조문 효력·개정 배지(article_integrity) 실렌더 검증 (dev 3101):
// 여비 질의 → 근거 패널 규정 카드에 '개정 YYYY.M.D' 배지(여비규정 제16조 최근개정 2016.12.5).
import { chromium } from "playwright";

// ⛔ 테스트 계정 비밀번호를 코드에 두지 않는다(보안 스캔 후속 — dev 계정 14개가
//    레포에 박힌 비밀번호로 열리던 것을 2026-07-29에 회전).
//    실행: set -a; . tools/.test_credentials; set +a; node <이 파일>
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — tools/.test_credentials 를 로드하세요.");
  process.exit(2);
}

const BASE = "http://localhost:3101"; // ⛔ dev만. prod(3100) 미사용.
const USER = "integritytest";
const PW = TEST_PW;
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
await p.fill('textarea[placeholder^="행정 업무"]', "국내출장 여비는 어떻게 지급되나요?");
await p.click('button[aria-label="보내기"]');
await p.waitForSelector('button[title="도움이 됐어요"]', { timeout: 240000 }).catch(() => {});
await p.waitForTimeout(1500);

const aside = p.locator("aside");
const revBadge = await aside.getByText(/개정 \d{4}\./).count();  // '개정 2016.12.5' 형태
ok(revBadge > 0, `1) 근거 카드 조문 개정 배지 노출 (${revBadge})`);

await aside.screenshot({ path: "verify-integrity-badge.png" }).catch(() => {});
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 조문 효력·개정 배지 검증 통과");
process.exit(fails.length ? 1 : 0);
