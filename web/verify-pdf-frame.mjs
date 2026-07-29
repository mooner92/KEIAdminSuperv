// 서식 미리보기 PDF가 **실제로 프레임에 로드되는지** 검증(2026-07-25 사용자 제보 회귀).
// ⚠ iframe 요소 존재만 확인하면 X-Frame-Options 차단을 놓친다(그래서 이 테스트가 생김).
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
const ctx = await b.newContext();
await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: TEST_PW } });
await ctx.route("**/app/flags**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ forms_registry: true }) }));
const p = await ctx.newPage();
const blocked = [];
p.on("console", (m) => { if (/Refused to display|X-Frame-Options|frame-ancestors/i.test(m.text())) blocked.push(m.text()); });
let pdfStatus = null, pdfHeaders = {};
p.on("response", (r) => {
  if (r.url().includes("/forms-pdf/") && r.url().includes(".pdf")) { pdfStatus = r.status(); pdfHeaders = r.headers(); }
});
await p.goto(`${BASE}/browse/?tab=forms`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
const framesBefore = p.frames().length;
await p.locator('[class*="Forms_titleBtn"]').first().click();
await p.waitForTimeout(2500);
const framesAfter = p.frames().length;
console.log(`  프레임 수: ${framesBefore} → ${framesAfter} (증가=PDF 프레임 생성)`);
console.log(`  PDF 응답: ${pdfStatus}`);
// ⚠ 결정적 판정은 **응답 헤더** — 프레임 수는 차단돼도 증가하고, 콘솔 메시지는 헤드리스에서
// 누락될 수 있다(2026-07-25 실측: 두 신호 모두 prod의 DENY를 놓쳤다).
const xfo = (pdfHeaders["x-frame-options"] || "").toUpperCase();
const csp = pdfHeaders["content-security-policy"] || "";
const ancestors = (csp.match(/frame-ancestors ([^;]+)/) || [, ""])[1].trim();
console.log(`  X-Frame-Options: ${xfo || "(없음)"} · frame-ancestors: ${ancestors || "(없음)"}`);
console.log(`  차단 콘솔 메시지: ${blocked.length}건 ${blocked[0] ? "→ " + blocked[0].slice(0, 80) : ""}`);
await b.close();
const framingOk = xfo !== "DENY" && ancestors !== "'none'";
if (!framingOk) { console.error("❌ 프레이밍 차단 헤더 — 실제 브라우저에서 미리보기가 안 보인다"); process.exit(1); }
if (pdfStatus !== 200 || framesAfter <= framesBefore) { console.error("❌ PDF 프레임 생성/응답 실패"); process.exit(1); }
console.log("🎉 PDF 프레임 로드 가능(헤더 허용 + 200)");
