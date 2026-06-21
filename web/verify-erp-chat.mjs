// #4 ERP·서식 연결(채팅) 실렌더 검증: 절차 질의 → 답변에 ERP 경로 + 근거 패널 🖥 ERP 칩.
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
let r = await ctx.request.post(`${BASE}/api/app/auth/register`, { data: { username: USER, password: PW } });
if (r.status() === 409) r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: USER, password: PW } });
ok(r.ok(), `0) 로그인 (${r.status()})`);

const p = await ctx.newPage();
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(1200);
await p.click('button:has-text("새 대화")').catch(() => {});
await p.waitForTimeout(400);
await p.fill('textarea[placeholder^="행정 업무"]', "경조사비 신청은 어떻게 하나요? ERP에서 어디서 처리해요?");
await p.click('button:has-text("보내기")');

await p.waitForSelector('button[title="도움이 됐어요"]', { timeout: 90000 }).catch(() => {});
await p.waitForTimeout(1200);

// 답변(중앙)에 ERP 경로 언급
const ansErp = await p.locator(".aiBubble, li").filter({ hasText: "ERP" }).count();
ok(ansErp > 0, "1) 답변에 ERP 경로 언급");

// 근거 패널(우측 aside)에 🖥 ERP 칩
const erpChip = await p.locator("aside").getByText("ERP", { exact: false }).count();
ok(erpChip > 0, `2) 근거 패널 🖥 ERP 칩 노출 (${erpChip})`);

await p.screenshot({ path: "verify-erp-chat.png", fullPage: false });
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ ERP·서식 연결(채팅) 검증 통과");
process.exit(fails.length ? 1 : 0);
