import { chromium } from "playwright";

// ⛔ 라이브 계정 비밀번호를 코드에 두지 않는다(보안 스캔 F1/F3/F12).
//    실행: set -a; . tools/.test_credentials; set +a; node <이 파일>
//    ⛔ admintest는 실재하지 않는 계정이다 — 기본값은 상주 픽스처 b6test.
//       관리자 화면(/admin) 테스트는 APP_TEST_USER=<APP_ADMINS 계정>을 함께 지정할 것.
const TEST_USER = process.env.APP_TEST_USER || "b6test";
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — 검증 계정 비밀번호는 환경변수로만 받습니다.");
  process.exit(2);
}

// OS는 라이트인데 앱만 다크로 토글한 상황(사용자 케이스)에서 전 페이지 배경이 다크인지 확인
const targets = ["/", "/browse/", "/graph/"]; // "/"는 미로그인 → 로그인 화면(역시 다크여야)
const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: "light" });
await ctx.addInitScript(() => localStorage.setItem("kei-theme", "dark"));
await ctx.request.post("http://localhost:3101/api/app/auth/login", { data: { username: TEST_USER, password: TEST_PW } }); // docs/44 게이트

for (const t of targets) {
  const page = await ctx.newPage();
  await page.goto("http://localhost:3101" + t, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-theme"),
    body: getComputedStyle(document.body).backgroundColor,
  }));
  const name = "verify" + (t.replace(/\//g, "_") || "_home") + ".png";
  await page.screenshot({ path: name, fullPage: true });
  console.log(t.padEnd(10), "data-theme=", r.theme, "| body=", r.body, "→", name);
  await page.close();
}
await browser.close();
