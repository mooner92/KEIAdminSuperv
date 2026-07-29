// 자가평가 이력 → 그날 상세(specs/07 C): 행 클릭→패널(오답만)·전체보기 이동·Esc.
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
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 950 } });
console.log("로그인:", (await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: TEST_PW } })).status());
await ctx.route("**/app/flags**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ quality_board: true }) }));
const p = await ctx.newPage();
await p.goto(`${BASE}/quality/trend/`, { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
const url0 = p.url();
// ① 날짜 클릭 → 패널
await p.locator('[class*="dateBtn"]').first().click();
// ⚠ SideDrawer는 닫혀 있어도 마크업이 존재한다(open 클래스로만 토글) — 열림을 명시적으로 기다린다.
await p.waitForSelector('[class*="SideDrawer_open"]', { timeout: 8000 });
await p.waitForTimeout(800);
const open = await p.locator('[class*="SideDrawer_open"]').count();
const items = await p.locator('[class*="DayDetailDrawer_item"]').count();
// ⚠ [class*="SideDrawer_title"]는 .title과 .titleWrap 둘 다 매칭(strict 위반) — 해시 구분자까지 명시
const title = await p.locator('[class*="SideDrawer_title__"]').innerText();
console.log(`  패널 ${open} · 제목 "${title}" · 확인필요 문항 ${items}건 · URL 유지 ${p.url() === url0}`);
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/quality-day.png" });
// ② 전체 문항 보기 → /quality?date=
await p.locator('[class*="DayDetailDrawer_full"]').click();
await p.waitForTimeout(2000);
const onDatePage = /\/quality\/?\?date=\d{4}-\d{2}-\d{2}/.test(p.url());
const label = await p.locator('[class*="Quality_scoreLabel"]').first().innerText().catch(() => "");
console.log(`  전체보기 이동: ${onDatePage ? "✅" : "❌"} ${p.url().split("/").pop()} · 라벨 "${label}"`);
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/quality-date.png" });
// ③ Esc 닫힘
await p.goBack(); await p.waitForTimeout(1200);
await p.locator('[class*="dateBtn"]').first().click();
await p.waitForSelector('[class*="SideDrawer_open"]', { timeout: 8000 });
await p.keyboard.press("Escape"); await p.waitForTimeout(600);
const closed = await p.locator('[class*="SideDrawer_open"]').count();
console.log(`  Esc 닫힘: ${closed === 0 ? "✅" : "❌"}`);
await b.close();
if (!open || !onDatePage || closed !== 0) { console.error("❌ 실패"); process.exit(1); }
console.log("🎉 이력 상세 검증 통과");
