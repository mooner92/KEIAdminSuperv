import { chromium } from "playwright";

// OS는 라이트인데 앱만 다크로 토글한 상황(사용자 케이스)에서 전 페이지 배경이 다크인지 확인
const targets = ["/", "/browse/", "/graph/"]; // "/"는 미로그인 → 로그인 화면(역시 다크여야)
const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: "light" });
await ctx.addInitScript(() => localStorage.setItem("kei-theme", "dark"));

for (const t of targets) {
  const page = await ctx.newPage();
  await page.goto("http://localhost:3100" + t, { waitUntil: "load" });
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
