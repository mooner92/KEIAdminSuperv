// 업데이트 배너 레이아웃 회귀(사용자 보고: 배너 등장으로 페이지 스크롤 생겨 푸터 클릭 불편).
// 판정: 채팅(100vh 공식)·fill 페이지에서 배너가 '페이지 스크롤을 추가로 만들지 않는다'.
// 좁은 화면(≤1080px)은 원래 적층 스크롤 설계라 '배너 유무 델타=0'으로 판정한다.
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
import { makeCheck } from "./verify-lib.mjs";
const { check, finish } = makeCheck();

const ctx = await b.newContext({ viewport: { width: 1500, height: 860 } });
await ctx.request.post(BASE + "/api/app/auth/login", { data: { username: TEST_USER, password: TEST_PW } });
const p = await ctx.newPage();
const measure = () => p.evaluate(() => ({
  banner: !!document.querySelector('button[aria-label="업데이트 알림 닫기"]'),
  over: document.documentElement.scrollHeight - window.innerHeight,
  footerIn: (() => { const r = document.querySelector("footer").getBoundingClientRect(); return r.bottom <= window.innerHeight + 1; })(),
  bannerH: getComputedStyle(document.documentElement).getPropertyValue("--banner-h"),
}));

// ① 넓은 화면 채팅: 배너 있어도 무스크롤 + 푸터 뷰포트 안
await p.goto(BASE + "/", { waitUntil: "load" });
await p.waitForTimeout(2000);
let m = await measure();
check("① 배너 표시 + 무스크롤 + 푸터 클릭 가능", m.banner && m.over <= 1 && m.footerIn, `--banner-h=${m.bannerH}, 초과 ${m.over}px`);
await p.screenshot({ path: "verify-banner-noscroll.png" });

// ② 배너 닫기 → 채팅 영역 복귀·무스크롤 유지
await p.click('button[aria-label="업데이트 알림 닫기"]');
await p.waitForTimeout(600);
m = await measure();
check("② 닫은 후 무스크롤 유지(--banner-h=0)", !m.banner && m.over <= 1 && m.footerIn, m.bannerH);

// ③ 좁은 화면: 적층 스크롤은 설계 — 배너가 '추가' 스크롤을 만들지 않는지(델타=배너높이 이하)
const nb = await b.newContext({ viewport: { width: 900, height: 800 } });
await nb.request.post(BASE + "/api/app/auth/login", { data: { username: TEST_USER, password: TEST_PW } });
const q = await nb.newPage();
await q.addInitScript(() => localStorage.setItem("kei-clog-dismissed", "__none__"));
await q.goto(BASE + "/", { waitUntil: "load" });
await q.waitForTimeout(2000);
const withBanner = await q.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
await q.evaluate(() => { document.querySelector('button[aria-label="업데이트 알림 닫기"]')?.click(); });
await q.waitForTimeout(600);
const noBanner = await q.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
check("③ 좁은 화면: 배너로 인한 추가 스크롤 없음", Math.abs(withBanner - noBanner) <= 45, `델타 ${withBanner - noBanner}px`);

// ④ fill 페이지(둘러보기): root flex가 배너 흡수 → 무스크롤
await p.evaluate(() => localStorage.removeItem("kei-clog-dismissed"));
await p.goto(BASE + "/browse/", { waitUntil: "load" });
await p.waitForTimeout(1500);
m = await measure();
check("④ 둘러보기(fill) 무스크롤", m.over <= 1 && m.footerIn, `초과 ${m.over}px`);

await b.close();
process.exit(finish());
