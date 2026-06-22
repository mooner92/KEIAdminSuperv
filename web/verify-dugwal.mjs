// 두괄식 실렌더 검증: 답변 첫 줄이 굵은(**) 결론으로 시작하는지.
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
await p.fill('textarea[placeholder^="행정 업무"]', "연차휴가는 어떻게 신청하나요?");
await p.click('button:has-text("보내기")');
await p.waitForSelector('button[title="도움이 됐어요"]', { timeout: 90000 }).catch(() => {});
await p.waitForTimeout(1000);

const res = await p.evaluate(() => {
  const bubbles = [...document.querySelectorAll('[class*="aiBubble"]')];
  const bub = bubbles[bubbles.length - 1];
  if (!bub) return { hasStrong: false };
  const strong = bub.querySelector("strong, b");
  const txt = (bub.innerText || "").trim();
  const st = strong ? (strong.innerText || "").trim() : "";
  return { hasStrong: !!strong, startsBold: !!st && txt.startsWith(st), head: txt.slice(0, 90), st: st.slice(0, 90) };
});
console.log("답변 머리:", res.head);
console.log("굵은 결론:", res.st);
ok(res.hasStrong, "1) 답변에 굵은(strong) 결론 존재");
ok(res.startsBold, "2) 답변이 굵은 결론으로 '시작'(두괄식)");

await p.screenshot({ path: "verify-dugwal.png", fullPage: false });
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 두괄식 렌더 검증 통과");
process.exit(fails.length ? 1 : 0);
