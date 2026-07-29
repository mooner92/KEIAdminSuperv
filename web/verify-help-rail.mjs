// docs/36 P4 — 도움말 페이지 ScrollRail 재사용 검증(데스크톱 레일·모바일 가로칩·점프·다크).
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
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const b = await chromium.launch();
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log((ok ? "✅" : "❌") + " " + n + (d ? " — " + d : "")); ok ? pass++ : fail++; };
const RAIL = 'nav[aria-label="페이지 섹션 이동"]';

// ① 데스크톱: 레일 노출 + 가로 칩 숨김
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
await ctx.request.post(BASE + "/api/app/auth/login", { data: { username: TEST_USER, password: TEST_PW } });
const p = await ctx.newPage();
await p.goto(BASE + "/help/", { waitUntil: "load" });
await p.waitForTimeout(1500);
check("① 레일 섹션 6개", (await p.locator(`${RAIL} button`).count()) === 6);
check("① 데스크톱 가로칩 숨김", !(await p.locator('nav[aria-label="도움말 목차"]').isVisible().catch(() => false)));

// ② 클릭 점프 + aria-current 하이라이트
await p.locator(`${RAIL} button`, { hasText: "문의" }).click();
await p.waitForTimeout(900);
const y = await p.evaluate(() => window.scrollY);
check("② 레일 클릭 → 하단 점프", y > 400, String(y));
const cur = await p.waitForFunction(() => {
  const el = document.querySelector('nav[aria-label="페이지 섹션 이동"] [aria-current="true"]');
  return el && el.textContent.includes("문의");
}, undefined, { timeout: 4000 }).then(() => true).catch(() => false);
check("② aria-current 하이라이트(문의)", cur);
// 헤더에 가리지 않는지(scroll-margin) — contact 섹션 top이 헤더 아래
const notHidden = await p.evaluate(() => {
  const s = document.getElementById("contact");
  return s ? s.getBoundingClientRect().top >= 40 : false;
});
check("② 점프 후 섹션이 헤더에 안 가림", notHidden);

// ③ FAQ 아코디언 열어도 레일 위치 재계산(문서 높이 변동 대응)
await p.locator(`${RAIL} button`, { hasText: "FAQ" }).click();
await p.waitForTimeout(500);
const details = p.locator("details").first();
await details.locator("summary").click();
await p.waitForTimeout(600);
check("③ 아코디언 열림 후에도 레일 유지", (await p.locator(`${RAIL} button`).count()) === 6);

// ④ 다크 실측
const pd = await ctx.newPage();
await pd.addInitScript(() => localStorage.setItem("kei-theme", "dark"));
await pd.goto(BASE + "/help/", { waitUntil: "load" });
await pd.waitForTimeout(1200);
const darkOn = await pd.evaluate(() => {
  const el = document.querySelector('nav[aria-label="페이지 섹션 이동"] [aria-current="true"]');
  if (!el) return 0;
  const m = getComputedStyle(el).color.match(/\d+/g).map(Number);
  return (m[0] + m[1] + m[2]) / 3;
});
check("④ 다크: 활성 라벨 밝음", darkOn > 150, String(darkOn));
await pd.close();

// ⑤ 모바일(768px): 레일 숨김 + 가로 칩 노출 + 가로 스크롤 0
const pm = await ctx.newPage();
await pm.setViewportSize({ width: 768, height: 900 });
await pm.goto(BASE + "/help/", { waitUntil: "load" });
await pm.waitForTimeout(1200);
check("⑤ 768px 레일 숨김", !(await pm.locator(RAIL).isVisible().catch(() => false)));
check("⑤ 768px 가로칩 노출", await pm.locator('nav[aria-label="도움말 목차"]').isVisible());
check("⑤ 768px 가로 스크롤 0", await pm.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await pm.close();

console.log(`\n${pass}/${pass + fail} 판정 통과`);
await b.close();
process.exit(fail ? 1 : 0);
