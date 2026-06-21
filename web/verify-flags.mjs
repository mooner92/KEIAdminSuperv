// 기능 플래그 end-to-end 실렌더 검증: 게이트 → 관리자 토글 → 배너 ON/OFF.
import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
const fails = [];

// 1) 로그아웃 상태 /admin → 게이트
await p.goto("http://localhost:3100/admin/", { waitUntil: "load" });
await p.waitForTimeout(1500);
const gate = await p.evaluate(() => {
  const t = document.body.innerText;
  return t.includes("관리자 전용") || t.includes("로그인이 필요");
});
console.log("1) 로그아웃 /admin 게이트:", gate);
if (!gate) fails.push("게이트 미작동");

// 1b) 로그아웃 상태 홈에는 '관리자' 링크 없어야
await p.goto("http://localhost:3100/", { waitUntil: "load" });
await p.waitForTimeout(1500);
const linkLoggedOut = await p.evaluate(() =>
  [...document.querySelectorAll("footer a")].some((a) => a.textContent.trim() === "관리자")
);
console.log("1b) 로그아웃 관리자 링크 숨김:", !linkLoggedOut, "(true 기대)");
if (linkLoggedOut) fails.push("로그아웃인데 관리자 링크 노출");

// 2) 관리자(mt_demo) 로그인
await p.goto("http://localhost:3100/", { waitUntil: "load" });
await p.waitForTimeout(1200);
await p.fill('input[placeholder="사번 또는 아이디"]', "mt_demo");
await p.fill('input[type="password"]', "test1234");
await p.click('button[type="submit"]');
await p.waitForTimeout(2800);

// 3) 관리자 페이지 토글 보임
await p.goto("http://localhost:3100/admin/", { waitUntil: "load" });
await p.waitForTimeout(1800);
const hasToggle = await p.evaluate(
  () => !!document.querySelector('[role="switch"]') && document.body.innerText.includes("demo_banner")
);
console.log("2) 관리자 토글 보임:", hasToggle);
if (!hasToggle) fails.push("관리자 토글 안 보임");
const linkAdmin = await p.evaluate(() =>
  [...document.querySelectorAll("footer a")].some((a) => a.textContent.trim() === "관리자")
);
console.log("2b) 관리자에게 관리자 링크 노출:", linkAdmin, "(true 기대)");
if (!linkAdmin) fails.push("관리자인데 링크 안 보임");
await p.screenshot({ path: "verify-flags-admin.png" });

// 4) 토글 ON
await p.evaluate(() => document.querySelector('[role="switch"]')?.click());
await p.waitForTimeout(1300);
const aria = await p.evaluate(() => document.querySelector('[role="switch"]')?.getAttribute("aria-checked"));
console.log("3) 토글 후 aria-checked:", aria, "(true 기대)");
if (aria !== "true") fails.push("토글 ON 실패");

// 5) 홈에 배너 표시
await p.goto("http://localhost:3100/", { waitUntil: "load" });
await p.waitForTimeout(1600);
const bannerOn = await p.evaluate(() => document.body.innerText.includes("새 기능 미리보기"));
console.log("4) 홈 배너 표시(ON):", bannerOn);
if (!bannerOn) fails.push("배너 ON 미반영");
await p.screenshot({ path: "verify-flags-banner.png" });

// 6) 토글 OFF → 배너 사라짐
await p.goto("http://localhost:3100/admin/", { waitUntil: "load" });
await p.waitForTimeout(1500);
await p.evaluate(() => document.querySelector('[role="switch"]')?.click());
await p.waitForTimeout(1300);
await p.goto("http://localhost:3100/", { waitUntil: "load" });
await p.waitForTimeout(1600);
const bannerOff = await p.evaluate(() => document.body.innerText.includes("새 기능 미리보기"));
console.log("5) 홈 배너 표시(OFF 후):", bannerOff, "(false 기대)");
if (bannerOff) fails.push("배너 OFF 미반영");

await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 기능 플래그 end-to-end 검증 통과");
process.exit(fails.length ? 1 : 0);
