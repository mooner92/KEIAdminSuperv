// 결재선 판정기 채팅 연동 검증 (dev 3101):
// 결재 관련 질문 → 근거 패널에 "결재선을 알아볼까요?" 카드(업무 키워드 감지) → 클릭 시
// 오른쪽 드로어로 판정기 오픈 + 키워드(휴가) 프리셋 → 결과 표시.
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const USER = "approvalchat";
const PW = "test1234";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const ctx = await b.newContext();
let r = await ctx.request.post(`${BASE}/api/app/auth/register`, { data: { username: USER, password: PW } });
if (!r.ok()) r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: USER, password: PW } });
ok(r.ok(), `0) 로그인 (${r.status()})`);

const p = await ctx.newPage({ viewport: { width: 1400, height: 1200 } });
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(1200);
await p.click('button:has-text("새 대화")').catch(() => {});
await p.waitForTimeout(400);
await p.fill('textarea[placeholder^="행정 업무"]', "휴가 쓰려면 결재 어떻게 올려야 하지?");
await p.click('button[aria-label="보내기"]');
await p.waitForSelector('button[title="도움이 됐어요"]', { timeout: 240000 }).catch(() => {});
await p.waitForTimeout(1500);

// 제안 카드
const cta = p.locator("aside button", { hasText: "결재선을 알아볼까요" });
ok((await cta.count()) > 0, "1) 근거 패널에 '결재선을 알아볼까요?' 제안 카드");
const ctaText = (await cta.first().textContent()) || "";
ok(ctaText.includes("휴가"), "2) 질문에서 업무 키워드 '휴가' 감지·표시");

// 클릭 → 드로어 오픈 + 프리셋
await cta.first().click();
await p.waitForTimeout(1200);
const drawer = p.locator('[aria-label="결재선 판정기"]');
ok((await drawer.count()) > 0, "3) 오른쪽 드로어로 결재선 판정기 오픈");
const qVal = await drawer.locator('input[aria-label="업무 검색"]').inputValue();
ok(qVal === "휴가", `4) 검색어 '휴가' 프리셋 (실제: ${qVal})`);
const body = (await drawer.textContent()) || "";
ok(/전결/.test(body) && /휴가/.test(body), "5) 휴가 관련 전결 결과 표시");
ok(body.includes("부서"), "6) '부서 확인' 면책 노출");

// 퀵칩: 존재 + 클릭 시 검색어 교체
const chips = drawer.locator('[aria-label="자주 찾는 업무"] button');
ok((await chips.count()) >= 5, `7) 자주 찾는 업무 퀵칩 렌더 (${await chips.count()}개)`);
await chips.filter({ hasText: "출장" }).first().click();
await p.waitForTimeout(400);
ok((await drawer.locator('input[aria-label="업무 검색"]').inputValue()) === "출장", "8) 칩 클릭 → 검색어 '출장' 교체");

// 0건 + 직급 필터 → 원클릭 해제 힌트 (병가는 정규/비정규 축이라 직급 필터에 안 걸림)
await drawer.locator('select[aria-label="신청자 직급"]').selectOption({ label: "비정규직(연구직)" });
await drawer.locator('input[aria-label="업무 검색"]').fill("병가");
await p.waitForTimeout(400);
const clearBtn = drawer.locator("button", { hasText: "직급 필터" });
ok((await clearBtn.count()) > 0, "9) 0건 시 '직급 필터 해제' 원클릭 힌트");
await clearBtn.first().click();
await p.waitForTimeout(400);
const afterClear = (await drawer.textContent()) || "";
ok(/병가/.test(afterClear) && /전결/.test(afterClear), "10) 해제 후 병가(정규/비정규) 결과 표시");
await drawer.screenshot({ path: "verify-approval-chat.png" });

await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 결재선 채팅 연동 검증 통과");
process.exit(fails.length ? 1 : 0);
