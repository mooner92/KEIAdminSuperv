// 답변 포맷(두괄식·볼드 렌더·LaTeX 제거) 실렌더 검증 (dev 3101).
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
const USER = "fmttest", PW = TEST_PW;
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const ctx = await b.newContext();
let r = await ctx.request.post(`${BASE}/api/app/auth/register`, { data: { username: USER, password: PW } });
if (!r.ok()) r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: USER, password: PW } });
const p = await ctx.newPage({ viewport: { width: 1400, height: 1200 } });
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(1000);
await p.click('button:has-text("새 대화")').catch(() => {});
await p.waitForTimeout(400);
await p.fill('textarea[placeholder^="행정 업무"]', "세종 본사에서 근무하는 부연구위원의 1일 서울 출장비");
await p.click('button[aria-label="보내기"]');
await p.waitForSelector('button[title="도움이 됐어요"]', { timeout: 240000 }).catch(() => {});
await p.waitForTimeout(1500);

const bubble = p.locator(".aiBubble, [class*=aiBubble], [class*=bubble]").last();
const visible = (await bubble.textContent()) || "";        // 렌더된(사람이 보는) 텍스트
const html = (await bubble.innerHTML()) || "";

ok(!visible.includes("$") && !visible.includes("\\text") && !visible.includes("\\times"), "1) LaTeX raw 미노출(사람이 보는 텍스트)");
ok(!/\*\*/.test(visible), "2) 리터럴 '**' 미노출(볼드가 렌더됨)");
ok(/<strong>/.test(html), "3) <strong> 볼드 렌더 존재");
// 두괄식: 첫 문단이 <strong>(굵은 결론)로 시작
const firstStrong = html.indexOf("<strong>");
ok(firstStrong >= 0 && firstStrong < 120, `4) 두괄식 — 앞부분에 굵은 결론(pos ${firstStrong})`);
ok(visible.includes("최종 판단은"), "5) 면책 문구 유지");
ok(visible.includes("원") && visible.length > 60, "6) 금액 답변 정상 노출");

console.log("\n--- 렌더된 답변(앞 200자) ---\n" + visible.slice(0, 200));
await bubble.screenshot({ path: "verify-answer-format.png" }).catch(() => p.screenshot({ path: "verify-answer-format.png" }));
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 답변 포맷 검증 통과");
process.exit(fails.length ? 1 : 0);
