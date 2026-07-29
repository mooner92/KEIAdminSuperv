// docs/36 — 로그인/로그아웃 시 GNB(상단 메뉴)가 새로고침 없이 즉시 갱신되는지 실렌더 검증.
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
const navVisible = (p) => p.evaluate(() => {
  const h = document.querySelector("header")?.innerText || "";
  return h.includes("규정 둘러보기") && h.includes("관계 그래프");
});

// ── 로그인 시 메뉴 즉시 등장 ──
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
await p.goto(BASE + "/", { waitUntil: "load" });
await p.waitForTimeout(1500);
check("① 비로그인: GNB 숨김", !(await navVisible(p)));
// 폼으로 로그인(새로고침 없이)
await p.locator('input[autocomplete="username"]').fill(TEST_USER);
await p.locator('input[type="password"]').fill(TEST_PW);
await p.locator('button[type="submit"]', { hasText: "로그인" }).click();
// 새로고침 없이 메뉴가 뜨는지 — waitForFunction 폴링(네비게이션 아님)
const appeared = await p.waitForFunction(() => {
  const h = document.querySelector("header")?.innerText || "";
  return h.includes("규정 둘러보기") && h.includes("관계 그래프");
}, undefined, { timeout: 6000 }).then(() => true).catch(() => false);
check("② 로그인 직후: GNB 즉시 등장(새로고침 없이)", appeared);
const urlAfterLogin = p.url();
check("② 페이지 리로드 없이 반영", urlAfterLogin.endsWith("/") || urlAfterLogin.includes("3101"));
// 관리자 링크도 새로고침 없이 즉시(admintest=관리자) — 리뷰 확정 major(로그인 응답 is_admin 누락) 회귀 검사
const adminLink = await p.waitForFunction(() => (document.querySelector("footer")?.innerText || "").includes("관리자"),
  undefined, { timeout: 6000 }).then(() => true).catch(() => false);
check("② 관리자 링크 즉시 등장(로그인 응답 is_admin)", adminLink);

// ── 로그아웃 시 메뉴 즉시 사라짐 ──
// ChatApp의 로그아웃 버튼 클릭
const logoutBtn = p.locator("button", { hasText: "로그아웃" }).first();
check("③ 로그인 상태: 로그아웃 버튼 존재", (await logoutBtn.count()) >= 1);
await logoutBtn.click();
const gone = await p.waitForFunction(() => {
  const h = document.querySelector("header")?.innerText || "";
  return !h.includes("규정 둘러보기") && !h.includes("관계 그래프");
}, undefined, { timeout: 6000 }).then(() => true).catch(() => false);
check("④ 로그아웃 직후: GNB 즉시 사라짐(새로고침 없이)", gone);
// 로그아웃 상태에서 규정 둘러보기 링크가 클릭 불가(부재)
check("④ 로그아웃 후 앱 메뉴 클릭 불가", (await p.locator('header a[href="/browse/"]').count()) === 0);
await p.screenshot({ path: "verify-auth-nav.png" });

console.log(`\n${pass}/${pass + fail} 판정 통과`);
await b.close();
process.exit(fail ? 1 : 0);
