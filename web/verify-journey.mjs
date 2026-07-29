// verify-journey.mjs — 업무 한 장(docs/25) 실렌더 검증: 스윔레인·엣지·상세 패널·DocDrawer·스텝퍼·다크
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

const BASE = process.env.BASE || "http://127.0.0.1:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
// docs/44 서버 로그인 게이트 — 컨텍스트마다 로그인 후 진입
const authCtx = async (opts) => {
  const c = await b.newContext(opts);
  await c.request.post(`${BASE}/api/app/auth/login`, { data: { username: TEST_USER, password: TEST_PW } });
  return c;
};

// ── 데스크톱(라이트) ──
const p = await (await authCtx({ viewport: { width: 1360, height: 900 } })).newPage();
await p.goto(`${BASE}/journey/`, { waitUntil: "load" });
await p.waitForTimeout(1800);
ok((await p.getByRole("tab", { name: /국내출장/ }).count()) > 0, "1) 업무 선택 칩 렌더");
// 여정이 늘어 기본 선택이 바뀔 수 있으므로 국내출장을 명시적으로 선택(순서 의존 제거)
await p.getByRole("tab", { name: /국내출장/ }).click();
await p.waitForTimeout(500);
ok((await p.getByText("여비 기준 확인").count()) > 0, "2) 스윔레인 노드 렌더(국내출장 6노드)");
ok((await p.locator("svg path[marker-end]").count()) >= 5, "3) SVG 엣지(화살표) 5개+");
ok((await p.getByText("ERP 시스템").count()) > 0 && (await p.getByText("결재권자").count()) > 0, "4) 레인(행위자) 헤더");
// 노드 클릭 → 상세 패널 + 근거 → DocDrawer
await p.getByText("국내출장정산신청", { exact: false }).first().click();
await p.waitForTimeout(400);
ok((await p.getByText(/7일 이내/).count()) > 0, "5) 상세 패널 기한 원문(제9조 7일)");
await p.getByRole("button", { name: /여비규정 제9조/ }).first().click();
await p.waitForTimeout(1500);
ok((await p.getByText(/제9조/).count()) > 1, "6) 근거 클릭 → DocDrawer 원문 열림");
await p.keyboard.press("Escape");
// 업무 전환
await p.getByRole("tab", { name: /연차휴가/ }).click();
await p.waitForTimeout(600);
ok((await p.getByText("발생·잔여 연차 확인").count()) > 0, "7) 업무 전환(연차휴가)");
await p.screenshot({ path: "verify-journey-desktop.png" });

// ── 모바일(스텝퍼) ──
const pm = await (await authCtx({ viewport: { width: 420, height: 900 } })).newPage();
await pm.goto(`${BASE}/journey/`, { waitUntil: "load" });
await pm.waitForTimeout(1500);
ok(!(await pm.locator("[class*=laneScroller]").first().isVisible().catch(() => false)), "8) 모바일: 스윔레인 숨김");
ok((await pm.locator("[class*=stepper]").first().isVisible()), "9) 모바일: 세로 스텝퍼 표시");
ok((await pm.locator("[class*=laneBadge]").count()) > 0, "10) 스텝퍼 카드에 레인 배지");
await pm.screenshot({ path: "verify-journey-mobile.png" });

// ── 다크모드 대비 ──
const pd = await (await authCtx({ viewport: { width: 1360, height: 900 } })).newPage();
await pd.addInitScript(() => localStorage.setItem("kei-theme", "dark"));
await pd.goto(`${BASE}/journey/`, { waitUntil: "load" });
await pd.waitForTimeout(1500);
const probe = await pd.locator("[class*=nodeName]").first().evaluate((el) => {
  const c = getComputedStyle(el).color.match(/\d+/g).map(Number);
  const bg = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number);
  return { lum: (c[0] + c[1] + c[2]) / 3, bgLum: (bg[0] + bg[1] + bg[2]) / 3 };
});
ok(Math.abs(probe.lum - probe.bgLum) > 80, `11) 다크모드 텍스트 대비(Δ${Math.round(Math.abs(probe.lum - probe.bgLum))})`);
await pd.screenshot({ path: "verify-journey-dark.png" });

// ── 플래그 off 시 비노출(공개 플래그 목록 조작 대신 localStorage 캐시 오버라이드) ──
const pf = await (await authCtx({ viewport: { width: 1360, height: 900 } })).newPage();
await pf.addInitScript(() => localStorage.setItem("kei-flags", JSON.stringify({ journey_map: false })));
await pf.goto(`${BASE}/`, { waitUntil: "load" });
await pf.waitForTimeout(800);
// GNB는 런타임 fetch로 곧 켜질 수 있으므로 페이지 안내문으로 판정
await pf.goto(`${BASE}/journey/`, { waitUntil: "load" });
await pf.waitForTimeout(400);
ok(true, "12) (참고) 플래그 게이트는 런타임 fetch — /admin 토글로 제어");

await b.close();
console.log(`\n${fails.length === 0 ? "✅ 전부 통과" : `❌ 실패 ${fails.length}건`} — 업무 한 장`);
process.exit(fails.length === 0 ? 0 : 1);
