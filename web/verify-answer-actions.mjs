// v1 ⑫(S6) 답변 액션 검증 — 복사·인용 앵커 칩·수치 대조 (dev 3101, flag answer_actions on).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const ctx = await b.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
let r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: "test1234" } });
ok(r.ok(), `0) 로그인 (${r.status()})`);
const flags = await (await ctx.request.get(`${BASE}/api/app/flags`)).json();
ok(flags.answer_actions === true, "1) answer_actions on");

const p = await ctx.newPage({ viewport: { width: 1440, height: 1100 } });
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(1800);

// 새 질문으로 인용이 확실한 답변 생성(여비 — [여비규정 제N조] 인용 관례)
await p.click('button:has-text("새 대화")').catch(() => {});
await p.waitForTimeout(400);
await p.fill('textarea[placeholder^="행정 업무"]', "국내출장 여비는 어떻게 지급되나요?");
await p.click('button:has-text("보내기")');
await p.waitForSelector('button[title="도움이 됐어요"]', { timeout: 240000 }).catch(() => {});
await p.waitForTimeout(1200);

// ① 인용 앵커 칩
const chips = p.locator('[class*="citedChip"]');
const nChips = await chips.count();
ok(nChips > 0, `2) 인용 앵커 칩 렌더 (${nChips}개)`);
if (nChips > 0) {
  await chips.first().click();
  await p.waitForTimeout(1300);
  const d = await p.locator('[aria-label="문서 보기"]').textContent();
  ok(/제\d+조/.test(d || ""), "3) 칩 클릭 → 드로어 조문 오픈");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
}

// ② 수치 대조 집계(금액 답변)
const audit = await p.locator('[class*="numAudit"]').count();
ok(audit > 0, `4) 수치 대조 집계 라인 (${audit})`);
const auditTxt = audit ? await p.locator('[class*="numAudit"]').last().textContent() : "";
ok(/수치 대조: 답변 속 \d+개 중/.test(auditTxt || ""), `5) 대조 형식 (${(auditTxt || "").slice(0, 40)}…)`);

// ③ 복사 — 출처+기준일 부착
await p.locator('button:has-text("📋 복사")').last().click();
await p.waitForTimeout(600);
ok((await p.locator('button:has-text("✓ 복사됨")').count()) > 0, "6) 복사 피드백(✓ 복사됨)");
const clip = await p.evaluate(() => navigator.clipboard.readText());
ok(clip.includes("[근거 출처]") && clip.includes("규정집 기준일") && /최종 판단/.test(clip), "7) 클립보드에 출처 목록+기준일+면책 포함");
await p.screenshot({ path: "verify-answer-actions.png" });
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 답변 액션 검증 통과");
process.exit(fails.length ? 1 : 0);
