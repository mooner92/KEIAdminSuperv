// 답변 피드백(👍/👎) end-to-end 실렌더 검증:
//   로그인 → 질문 전송 → 👍 → 새로고침 영속 → 👎 + 사유 → 상태 반영.
// 로그인은 폼 대신 API(register/login, 같은 컨텍스트 쿠키)로 결정적으로 처리.
import { chromium } from "playwright";

const BASE = "http://localhost:3100";
const USER = "fb_test";
const PW = "test1234";
const fails = [];
const ok = (c, m) => {
  console.log((c ? "✅ " : "❌ ") + m);
  if (!c) fails.push(m);
};

const b = await chromium.launch();
const ctx = await b.newContext();

// 1) 로그인(쿠키를 컨텍스트에 심는다)
let r = await ctx.request.post(`${BASE}/api/app/auth/register`, { data: { username: USER, password: PW } });
if (r.status() === 409) r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: USER, password: PW } });
ok(r.ok(), `1) 로그인/등록 (${r.status()})`);

const p = await ctx.newPage();
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(1500);

// 2) 새 대화 + 질문 전송
await p.click('button:has-text("새 대화")').catch(() => {});
await p.waitForTimeout(500);
await p.fill('textarea[placeholder^="행정 업무"]', "연차휴가는 어떻게 신청하나요?");
await p.click('button:has-text("보내기")');

// 3) 답변 완료(=피드백 버튼 등장) 대기 — 스트리밍이 끝나 영속 메시지가 되면 버튼이 뜬다
const up = 'button[title="도움이 됐어요"]';
const down = 'button[title="부정확하거나 부족해요"]';
await p.waitForSelector(up, { timeout: 90000 }).catch(() => {});
ok(await p.locator(up).count() > 0, "2) 답변 후 👍/👎 버튼 등장");

// 4) 👍 클릭 → aria-pressed=true
await p.locator(up).last().click();
await p.waitForTimeout(800);
ok((await p.locator(up).last().getAttribute("aria-pressed")) === "true", "3) 👍 클릭 → aria-pressed=true");
await p.screenshot({ path: "verify-feedback-up.png" });

// 5) 새로고침 후 영속 확인(첫 대화 자동 선택)
await p.reload({ waitUntil: "load" });
await p.waitForSelector(up, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(800);
ok((await p.locator(up).last().getAttribute("aria-pressed")) === "true", "4) 새로고침 후 👍 영속");

// 6) 👎 클릭 → 사유창 → 사유 입력 + Enter 제출
await p.locator(down).last().click();
await p.waitForTimeout(600);
const reason = 'input[placeholder^="무엇이 부정확"]';
ok(await p.locator(reason).count() > 0, "5) 👎 → 사유 입력창 노출");
await p.fill(reason, "표의 금액이 누락됨");
await p.press(reason, "Enter");
await p.waitForTimeout(900);
ok((await p.locator(down).last().getAttribute("aria-pressed")) === "true", "6) 👎 확정 → aria-pressed=true");
ok((await p.locator(up).last().getAttribute("aria-pressed")) === "false", "6b) 👍는 해제됨(상호배타)");

// 7) 새로고침 후 사유 영속
await p.reload({ waitUntil: "load" });
await p.waitForSelector(down, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(800);
ok((await p.locator(down).last().getAttribute("aria-pressed")) === "true", "7) 새로고침 후 👎 영속");
const shown = await p.locator("text=표의 금액이 누락됨").count();
ok(shown > 0, "7b) 새로고침 후 사유 텍스트 표시");
await p.screenshot({ path: "verify-feedback-down.png" });

await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 답변 피드백 end-to-end 검증 통과");
process.exit(fails.length ? 1 : 0);
