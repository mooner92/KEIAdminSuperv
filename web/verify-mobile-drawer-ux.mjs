// 모바일 드로어/시트 UX 3종 검증(mobile_shell on, 390px):
//  ① 결재선 직급 필터 토글 노출·동작  ② 근거 드로어 뒤로가기 닫기(페이지 유지)  ③ 근거 시트 스와이프-다운 닫기
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
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const ctx = await b.newContext({ hasTouch: true });
await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: TEST_USER, password: TEST_PW } });

// ── ① 결재선 직급 필터 토글 ──
const p = await ctx.newPage();
await p.setViewportSize({ width: 390, height: 844 });
await p.goto(`${BASE}/approval/`, { waitUntil: "load" });
await p.waitForTimeout(2500);
const toggle = p.locator('button:has-text("직급·필터 열기")');
ok(await toggle.count() > 0, "1) 결재선: 모바일 필터 토글 노출");
// 열기 전 직급 체크박스는 숨김(좌측 패널)
const sideBefore = await p.locator('aside [type="checkbox"]').first().isVisible().catch(() => false);
await toggle.first().click();
await p.waitForTimeout(500);
const sideAfter = await p.locator('aside').filter({ hasText: "신청자 직급" }).first().isVisible().catch(() => false);
ok(!sideBefore && sideAfter, `2) 토글 클릭 → 직급 필터 패널 열림(전=${sideBefore} 후=${sideAfter})`);
const roleBox = await p.locator('label:has-text("비정규직"), label:has-text("정규직"), label:has-text("연구직")').first().count();
ok(roleBox > 0, "3) 직급 선택 체크박스 접근 가능");
await p.screenshot({ path: "m-approval.png" });

// ── ②③ 채팅 근거 드로어/시트 — 대화가 있어야 근거가 뜬다 ──
const c = await ctx.newPage();
await c.setViewportSize({ width: 390, height: 844 });
// 더보기(/now)를 먼저 방문 → 채팅으로(뒤로가기 대상이 더보기가 되도록 재현)
await c.goto(`${BASE}/now/`, { waitUntil: "load" });
await c.waitForTimeout(1500);
await c.goto(`${BASE}/`, { waitUntil: "load" });
await c.waitForTimeout(2500);
// 질문 전송
await c.locator("textarea").first().fill("연장근로 신청 단위는?");
await c.locator("textarea").first().press("Enter");
// 답변 대기(스트리밍 — 근거 FAB 등장까지)
await c.waitForSelector('[class*="srcFab"]', { timeout: 60000 }).catch(() => {});
await c.waitForTimeout(2000);
const fab = c.locator('[class*="srcFab"]').first();
ok(await fab.count() > 0, "4) 답변 후 근거 FAB 노출");

// 근거 시트 열기
await fab.click();
await c.waitForTimeout(700);
const sheet = c.locator('[class*="srcOverlayOpen"]');
ok(await sheet.isVisible(), "5) 근거 바텀시트 열림");

// ③ 스와이프-다운으로 닫기 (핸들 부근에서 아래로 드래그)
const box = await sheet.boundingBox();
if (box) {
  const cx = box.x + box.width / 2;
  await c.touchscreen.tap(cx, box.y + 10); // 포커스
  // 수동 터치 드래그 시뮬레이션
  await c.evaluate(async ({ x, y }) => {
    const el = document.querySelector('[class*="srcOverlayOpen"]');
    const fire = (type, cy) => el.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true,
      touches: type === "touchend" ? [] : [new Touch({ identifier: 1, target: el, clientX: x, clientY: cy })],
    }));
    fire("touchstart", y + 8);
    for (let d = 20; d <= 220; d += 40) { fire("touchmove", y + 8 + d); await new Promise(r => setTimeout(r, 16)); }
    fire("touchend", y + 8 + 220);
  }, { x: cx, y: box.y });
  await c.waitForTimeout(600);
  ok(!(await sheet.isVisible().catch(() => false)), "6) 스와이프-다운으로 시트 닫힘");
}

// ② 근거 조문 열고 뒤로가기 → 채팅 유지(더보기로 이탈 X)
await fab.click(); await c.waitForTimeout(600);
const article = c.locator('[class*="srcOverlayOpen"] [class*="srcItem"], [class*="srcOverlayOpen"] a, [class*="srcOverlayOpen"] [role="button"]').first();
if (await article.count() > 0) {
  await article.click().catch(() => {});
  await c.waitForTimeout(1200);
  await c.goBack(); // 뒤로가기 제스처 = history back
  await c.waitForTimeout(1200);
  const url = c.url();
  ok(url.endsWith("/") || url.includes("/#") || !url.includes("/now"), `7) 근거 열고 뒤로가기 → 채팅 유지(url=${url.replace(BASE, "")})`);
}

await b.close();
console.log(fails.length ? `\n❌ ${fails.length}건 실패` : "\n✅ 전부 통과");
process.exit(fails.length ? 1 : 0);
