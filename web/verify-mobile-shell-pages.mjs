// 셸 켜짐(mobile_shell on) 상태 전 페이지 모바일(390) 회귀 — 페이지 가로 오버플로 0 + 하단 탭바 상존.
// ⚠ 판정은 '페이지 레벨 scrollWidth-clientWidth'로만(오프스크린 드로어·ellipsis·내부 스크롤 컨테이너
//    forms표/admin탭바는 페이지를 스크롤시키지 않으므로 오탐 제외). dev 3101, mobile_shell=on 전제.
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
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: TEST_USER, password: TEST_PW } });
const p = await ctx.newPage();
await p.setViewportSize({ width: 390, height: 844 });

const PAGES = ["/", "/browse/", "/now/", "/graph/", "/calendar/", "/forms/", "/approval/",
  "/journey/", "/feedback/", "/changelog/", "/help/", "/about/", "/admin/"];

for (const path of PAGES) {
  await p.goto(BASE + path, { waitUntil: "load" });
  await p.waitForTimeout(2000);
  const r = await p.evaluate(() => {
    const de = document.documentElement;
    const bar = document.querySelector('nav[aria-label="모바일 메뉴"]');
    const barBox = bar ? bar.getBoundingClientRect() : null;
    return {
      ov: de.scrollWidth - de.clientWidth,
      hasBar: !!bar,
      barBottom: barBox ? Math.round(barBox.bottom) : null,
    };
  });
  ok(r.ov <= 0 && r.hasBar && r.barBottom === 844,
    `${path} — 오버플로 ${r.ov}px · 탭바 ${r.hasBar ? `하단(${r.barBottom})` : "없음"}`);
}
await b.close();
console.log(fails.length ? `\n❌ ${fails.length}건 실패` : `\n✅ 전 페이지(${PAGES.length}) 셸 정상`);
process.exit(fails.length ? 1 : 0);
