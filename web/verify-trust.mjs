// #2 금액 신뢰 강화 + 규정집 기준일 실렌더 검증:
//   footer 기준일 → 금액 질문 → 금액 경고/수치 강조 → 근거 검수 배지.
// 한글 폰트 설치 후 실행하면 스크린샷에 한글이 정상 표기된다.
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
const USER = "fb_test";
const PW = TEST_PW;
const fails = [];
const ok = (c, m) => {
  console.log((c ? "✅ " : "❌ ") + m);
  if (!c) fails.push(m);
};

const b = await chromium.launch();
const ctx = await b.newContext();
let r = await ctx.request.post(`${BASE}/api/app/auth/register`, { data: { username: USER, password: PW } });
if (!r.ok()) r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: USER, password: PW } });
ok(r.ok(), `0) 로그인 (${r.status()})`);

const p = await ctx.newPage();
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(1500);

// 1) footer 규정집 기준일
const asOf = await p.locator("text=규정집 기준일 2026.06.19").count();
ok(asOf > 0, "1) footer 규정집 기준일 2026.06.19 표시");

// 2) 금액 질문 전송
await p.click('button:has-text("새 대화")').catch(() => {});
await p.waitForTimeout(400);
await p.fill('textarea[placeholder^="행정 업무"]', "국내 출장 숙박비 한도는 얼마인가요?");
await p.click('button[aria-label="보내기"]');

// 3) 답변 완료 대기(피드백 버튼=완료 신호)
await p.waitForSelector('button[title="도움이 됐어요"]', { timeout: 90000 }).catch(() => {});
await p.waitForTimeout(1000);

// 4) 금액·한도 경고 또는 근거 수치 강조(mark) 중 하나 이상
const moneyNote = await p.locator("text=금액·한도가 포함된 답변").count();
const figMarks = await p.locator("aside mark").count();
ok(moneyNote > 0 || figMarks > 0, `2) 금액 경고(${moneyNote}) 또는 수치 강조 mark(${figMarks})`);

// 5) 근거 카드 검수 배지(현재 전건 미검수 → '미검수' 배지 노출)
const badge = await p.locator("text=미검수").count();
ok(badge > 0, `3) 근거 검수상태 배지 노출(미검수 ${badge})`);

await p.screenshot({ path: "verify-trust.png", fullPage: false });
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 금액 신뢰 + 기준일 검증 통과");
process.exit(fails.length ? 1 : 0);
