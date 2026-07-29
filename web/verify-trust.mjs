// #2 금액 신뢰 강화 + 문서 기준일 실렌더 검증:
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

// 1) footer 문서 기준일
// ⚠ 대장 #86(워딩 규정→문서)에서 '규정집 기준일' → **'문서 기준일'**로 바뀌었다.
//   테스트가 옛 워딩을 계속 찾아 실패하고 있었다(제품 결함 아님).
//   날짜는 web/lib/site.ts의 CORPUS_AS_OF 단일 출처에서 유도 — 갱신 때 테스트가 낡지 않게.
const asOf = await p.locator("text=문서 기준일").count();
ok(asOf > 0, "1) footer 문서 기준일 표시");

// 2) 금액 질문 전송
await p.click('button:has-text("새 대화")').catch(() => {});
await p.waitForTimeout(400);
await p.fill('textarea[placeholder^="행정 업무"]', "국내 출장 숙박비 한도는 얼마인가요?");
await p.click('button[aria-label="보내기"]');

// 3) 답변 완료 대기
// ⚠ 옛 신호 `button[title="도움이 됐어요"]`는 **복원된 이전 대화의 메시지**에도 있어서
//   새 답변이 아직 '문서 검색 중…'인데 즉시 통과했다(실측 — 스크린샷으로 확인).
//   그래서 ⓐ 생성 표시가 사라지고 ⓑ 근거 버튼이 나타날 때까지 기다린다.
await p.waitForFunction(() => !document.body.innerText.includes("문서 검색 중"),
  { timeout: 120000 }).catch(() => {});
await p.waitForSelector('button:has-text("조문 보기")', { timeout: 120000 }).catch(() => {});
await p.waitForTimeout(800);

// 4) 금액·한도 경고 또는 근거 수치 강조(mark) 중 하나 이상
const moneyNote = await p.locator("text=금액·한도가 포함된 답변").count();
const figMarks = await p.locator("aside mark, [class*=\"srcPanel\"] mark").count();
ok(moneyNote > 0 || figMarks > 0, `2) 금액 경고(${moneyNote}) 또는 수치 강조 mark(${figMarks})`);

// 5) 검수상태 고지 — ⚠ v2에서 **두 번** 바뀌었고 테스트가 둘 다 놓쳤다(제품 결함 아님):
//    ⓐ 근거가 온디맨드다 → 답변 말풍선을 클릭해야 패널이 열린다
//    ⓑ 카드마다 '미검수' 배지를 반복하지 않고 **헤더에서 1회 집계**한다
//       (source_card_v2 ON일 때. ChatApp `reviewedCnt` — 전건 미검수면 '사람 검수 전' 문구)
//    그래서 판정은 '카드에 미검수 배지가 있나'가 아니라
//    **'검수상태가 사용자에게 고지되는가'**로 한다 — 표현이 바뀌어도 계약은 유지된다.
// v2는 **`근거 N개 · 조문 보기`** 버튼으로 근거를 연다(온디맨드).
await p.locator('button:has-text("조문 보기")').last().click().catch(() => {});
await p.waitForTimeout(1200);
const panel = await p.innerText("body");
const notice = /사람 검수 (완료|전)|검수 전\) 기준|미검수/.test(panel);
ok(notice, `3) 근거 검수상태 고지 노출 ${notice ? "" : "(헤더 집계·카드 배지 모두 없음)"}`);

await p.screenshot({ path: "verify-trust.png", fullPage: false });
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 금액 신뢰 + 기준일 검증 통과");
process.exit(fails.length ? 1 : 0);
