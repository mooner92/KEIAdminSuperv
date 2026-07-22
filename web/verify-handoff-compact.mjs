// 핸드오프 카드 컴팩트화 검증 — 한 줄 텍스트 + 알약 버튼, 복사 동작 유지 (dev 3101).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const S = "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1360, height: 950 }, permissions: ["clipboard-read", "clipboard-write"] });
await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: "test1234" } });
await ctx.route("**/app/flags", async (route) => {
  const res = await route.fetch(); const f = await res.json();
  route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...f, handoff_card: true }) });
});
const p = await ctx.newPage();
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(1200);
await p.click('button:has-text("새 대화")').catch(() => {});
await p.waitForTimeout(500);
await p.locator("textarea").fill("사내 주차장 배정 우선순위가 어떻게 되나요?");
await p.click('button[aria-label="보내기"]');
console.log("   … 거부 답변 대기(최대 240s)");
const card = p.getByText(/규정 밖 내용이면 담당 부서/);
await card.waitFor({ timeout: 240000 }).catch(() => {});
ok(await card.count() === 1, "1) 컴팩트 핸드오프 줄 노출");
// 큰 제목 문구가 사라졌는지(컴팩트화 확인)
ok(await p.getByText("담당 부서에 물어볼 준비를 도와드릴게요").count() === 0, "2) 큰 제목 박스 제거됨");
// 높이 측정 — 컴팩트(< 60px)인지
const box = await card.locator("xpath=ancestor::div[1]").boundingBox();
ok(box && box.height < 60, `3) 카드 높이 컴팩트: ${box ? Math.round(box.height) : "?"}px (<60)`);
await p.screenshot({ path: `${S}/handoff-compact.png`, clip: box ? { x: box.x - 8, y: box.y - 60, width: 660, height: 200 } : undefined });
// 복사 동작 유지
const btn = p.getByRole("button", { name: /문의 내용 복사/ });
ok(await btn.count() === 1, "4) 복사 버튼 존재");
await btn.click();
await p.waitForTimeout(400);
const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => "");
ok(clip.includes("주차장") && clip.includes("규정집 기준일"), `5) 복사 텍스트 정상(${clip.length}자)`);
ok(await p.getByText("✓ 복사됐어요").count() === 1, "6) 복사 피드백");
// 다크 스크린샷
const box2 = await card.locator("xpath=ancestor::div[1]").boundingBox();
await p.emulateMedia({ colorScheme: "dark" });
await p.screenshot({ path: `${S}/handoff-compact-dark.png`, clip: box2 ? { x: box2.x - 8, y: box2.y - 60, width: 660, height: 200 } : undefined });
await b.close();
console.log(fails.length ? `\n❌ 실패 ${fails.length}건` : "\n🎉 전부 통과");
process.exit(fails.length ? 1 : 0);
