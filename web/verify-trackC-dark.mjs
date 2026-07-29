// Track C 다크모드 가독성 확인 — 인사규정 드로어를 dark로 열어 스크린샷 + 대비 점검.
import { chromium } from "playwright";

// ⛔ 라이브 계정 비밀번호를 코드에 두지 않는다(보안 스캔 F1/F3/F12).
//    실행: APP_TEST_USER=... APP_TEST_PASS=... node <이 파일>
const TEST_USER = process.env.APP_TEST_USER || "admintest";
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — 검증 계정 비밀번호는 환경변수로만 받습니다.");
  process.exit(2);
}
const BASE = "http://localhost:3101";
const b = await chromium.launch();
const ctx = await b.newContext({ colorScheme: "dark" });
await ctx.request.post(BASE + "/api/app/auth/login", { data: { username: TEST_USER, password: TEST_PW } }); // docs/44 게이트

const p = await ctx.newPage({ viewport: { width: 760, height: 1200 } });
await p.addInitScript(() => localStorage.setItem("kei-theme", "dark")); // FOUC 스크립트가 읽는 키

await p.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
await p.locator('input[aria-label="검색"]').first().fill("인사규정");
await p.waitForTimeout(900);
await p.getByText("인사규정", { exact: true }).first().click();
await p.waitForTimeout(1300);

// 칩 텍스트 실제 렌더 색 확인(다크에서 밝은 본문색이어야)
const chip = p.locator('[aria-label="문서 보기"] button', { hasText: /보수규정|명예퇴직/ }).first();
const color = await chip.evaluate((el) => getComputedStyle(el).color).catch(() => "n/a");
const bg = await chip.evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => "n/a");
const theme = await p.evaluate(() => document.documentElement.getAttribute("data-theme"));
console.log("data-theme:", theme, "| 칩 color:", color, "| 칩 bg:", bg);

// 패널(개정 파급)로 스크롤해 실제 칩이 보이게 캡처
await p.getByText("개정 파급", { exact: false }).first().scrollIntoViewIfNeeded();
await p.waitForTimeout(500);
await p.locator('[aria-label="문서 보기"]').screenshot({ path: "verify-trackC-dark.png" });
await b.close();
console.log("✅ 다크모드 스크린샷 → verify-trackC-dark.png");
