// 버그 수정 검증: ① 복사 폴백(HTTP/비보안 컨텍스트) ② 굵게 안 따옴표 마크다운 교정 (dev 3101).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const ctx = await b.newContext();
let r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: "test1234" } });
ok(r.ok(), `0) 로그인 (${r.status()})`);
const p = await ctx.newPage({ viewport: { width: 1440, height: 1100 } });
// 사내 IP(HTTP) 접속 시뮬레이션 — clipboard API 제거 → execCommand 폴백 경로 강제
await p.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { get: () => undefined }); });
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(1500);
await p.click('button:has-text("새 대화")').catch(() => {});
await p.waitForTimeout(400);
await p.fill('textarea[placeholder^="행정 업무"]', "연차휴가는 어떻게 신청하나요?");
await p.click('button[aria-label="보내기"]');
await p.waitForSelector('button[title="도움이 됐어요"]', { timeout: 240000 }).catch(() => {});
await p.waitForTimeout(1000);

// ① 마크다운: 렌더된 답변에 원시 ** 노출 없어야
const bubble = p.locator('[class*="aiBubble"]').last();
const txt = (await bubble.innerText()) || "";
ok(!txt.includes("**"), `1) 렌더 답변에 원시 ** 없음 (굵게 정상 적용)`);
ok((await bubble.locator("strong").count()) > 0, "2) <strong> 요소 실재(굵게 렌더 확인)");

// ② 복사 폴백: clipboard API 없는 환경에서도 ✓ 복사됨
await p.locator('button:has-text("📋 복사")').last().click();
await p.waitForTimeout(700);
ok((await p.locator('button:has-text("✓ 복사됨")').count()) > 0, "3) clipboard 미지원(HTTP) 환경에서 복사 성공(폴백)");
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 버그 수정 검증 통과");
process.exit(fails.length ? 1 : 0);
