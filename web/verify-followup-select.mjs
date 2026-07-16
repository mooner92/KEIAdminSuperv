// docs/26 검증: ③후속 질문 칩(전송·여정 점프) ④원문 선택 질문(프리필·무전송)
import { chromium } from "playwright";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.request.post("http://127.0.0.1:3101/api/app/auth/login", { data: { username: "admintest", password: "admtest123" } });
const p = await ctx.newPage();
await p.goto("http://127.0.0.1:3101/", { waitUntil: "load" });
await p.waitForTimeout(1500);
await p.click('button:has-text("새 대화")').catch(() => {});
await p.fill('textarea[placeholder^="행정 업무"]', "국내출장 신청 어떻게 해?");
await p.click('button[aria-label="보내기"]');
await p.waitForSelector('button[title="도움이 됐어요"]', { timeout: 300000 });
await p.waitForTimeout(700);

// ③ 후속 칩
const chips = await p.locator('[class*=suggestChip]').count();
ok(chips >= 2, `1) 후속 제안 칩 ${chips}개`);
ok((await p.getByText("🗺 국내출장 전체 여정 보기").count()) > 0, "2) 여정 점프 칩");
const askChip = p.locator('button[class*=suggestChip]').first();
const chipLabel = await askChip.textContent();
await askChip.click();
await p.waitForSelector('button[title="도움이 됐어요"]', { timeout: 300000 });
await p.waitForTimeout(500);
ok((await p.getByText(/정산.*어떻게|기한.*언제/).count()) > 0, `3) 칩 클릭 → 후속 질문 전송("${chipLabel.trim()}")`);
await p.screenshot({ path: "verify-followup.png" });

// ④ 선택 질문 — 근거 열어 드로어에서 드래그
await p.locator('[class*=srcCard], [class*=srcItem], aside li button').first().click();
await p.waitForTimeout(1500);
const article = p.locator("article").first();
ok(await article.isVisible(), "4) 원문 드로어 열림");
// 첫 문단 일부를 선택(트리플클릭 → 문장 선택)
const para = article.locator("p, li").filter({ hasText: /.{10,}/ }).first();
await para.click({ clickCount: 3 });
await p.waitForTimeout(400);
const btn = p.getByRole("button", { name: /이거 물어보기/ });
ok((await btn.count()) > 0, "5) 선택 팝오버 표시");
const before = await p.locator('button[title="도움이 됐어요"]').count();
await btn.click();
await p.waitForTimeout(800);
const val = await p.locator('textarea[placeholder^="행정 업무"]').inputValue();
ok(val.includes("이게 무슨 뜻인가요") && val.includes("「"), `6) 입력창 프리필(자동 전송 없음): ${val.slice(0, 40)}…`);
const after = await p.locator('button[title="도움이 됐어요"]').count();
ok(after === before, `7) 자동 전송 안 됨(답변 수 ${before}→${after})`);
await p.screenshot({ path: "verify-select-ask.png" });
await b.close();
console.log(`\n${fails.length === 0 ? "✅ 전부 통과" : `❌ ${fails.length}건 실패`}`);
process.exit(fails.length ? 1 : 0);
