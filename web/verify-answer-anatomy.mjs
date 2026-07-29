// docs/38 §B: 답변 해부 레이아웃 검증 — 콜아웃·스테퍼 렌더 + ⛔문구 불변(같은 저장 메시지 재렌더) (dev 3101).
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
const S = "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1360, height: 1000 } });
await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: TEST_PW } });
let anatomy = true; // 라우트가 이 값을 반영 → 재로드로 ON/OFF 전환(재생성 없음)
await ctx.route("**/app/flags", async (route) => {
  const res = await route.fetch(); const f = await res.json();
  route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...f, answer_anatomy: anatomy }) });
});
const p = await ctx.newPage();
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(1000);
await p.click('button:has-text("새 대화")').catch(() => {});
await p.waitForTimeout(400);
await p.locator("textarea").fill("초과근무 수당 지급 기준이 궁금해요.");
await p.click('button[aria-label="보내기"]');
await p.waitForSelector('button[title="도움이 됐어요"]', { timeout: 240000 }).catch(() => {});
await p.waitForTimeout(800);

const bubbleText = async () => {
  const bubble = p.locator("li").filter({ has: p.locator('button[title="도움이 됐어요"]') }).first();
  return (await bubble.locator("div").first().innerText()).replace(/\s+/g, " ").trim();
};
// ① 해부 ON 렌더 확인
ok(await p.locator('div[class*="answerAnatomy"]').count() >= 1, "1) 해부 래퍼 존재(ON)");
const badge = await p.evaluate(() => {
  const li = document.querySelector('div[class*="answerAnatomy"] ol > li');
  return li ? getComputedStyle(li, "::before").borderTopLeftRadius : null;
});
ok(badge === "50%", `2) 스텝 배지 원형(radius=${badge})`);
const callout = await p.evaluate(() => {
  const pp = document.querySelector('div[class*="answerAnatomy"] > div > p:first-child');
  return pp ? getComputedStyle(pp).borderLeftWidth : null;
});
ok(callout && parseFloat(callout) >= 2, `3) 핵심답 콜아웃 좌측 강조(border=${callout})`);
const textOn = await bubbleText();
await p.screenshot({ path: `${S}/anatomy-on.png` });
await p.emulateMedia({ colorScheme: "dark" });
await p.screenshot({ path: `${S}/anatomy-on-dark.png` });
await p.emulateMedia({ colorScheme: "light" });

// ② 같은 채팅을 해부 OFF로 재로드(재생성 없음) → 텍스트 완전 동일해야
anatomy = false;
await p.reload({ waitUntil: "load" });
await p.waitForSelector('button[title="도움이 됐어요"]', { timeout: 20000 });
await p.waitForTimeout(600);
ok(await p.locator('div[class*="answerAnatomy"]').count() === 0, "4) 재로드 OFF일 때 래퍼 없음");
const textOff = await bubbleText();
const same = textOn === textOff;
ok(same, `6) ⛔문구 불변 — 같은 메시지 해부 ON/OFF 텍스트 ${same ? "완전 동일" : "다름"}(${textOn.length}자 vs ${textOff.length}자)`);
if (!same) { console.log("ON :", textOn.slice(0, 200)); console.log("OFF:", textOff.slice(0, 200)); }
await b.close();
console.log(fails.length ? `\n❌ 실패 ${fails.length}건` : "\n🎉 전부 통과");
process.exit(fails.length ? 1 : 0);
