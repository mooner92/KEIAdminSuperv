import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const S = "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad";
const fails=[]; const ok=(c,m)=>{console.log((c?"✅ ":"❌ ")+m);if(!c)fails.push(m)};
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: "test1234" } });
await ctx.route("**/app/flags", async (r)=>{const res=await r.fetch();const f=await res.json();r.fulfill({contentType:"application/json",body:JSON.stringify({...f,deadlines_hub:true})});});
const p = await ctx.newPage();
await p.goto(`${BASE}/deadlines/`, { waitUntil: "networkidle" });
await p.waitForSelector("ul li", { timeout: 10000 });
const rows = await p.locator("main ul li, .deadlines ul li").count().catch(()=>0);
const total = await p.locator("li").count();
ok(total >= 20, `1) 목록 렌더(행 ${total}개)`);
ok((await p.getByText(/기한 \d+건/).count())>=1, "2) 히어로에 총 기한 수 표기");
await p.screenshot({ path: `${S}/deadlines-list.png` });
// 검색
await p.fill('input[aria-label="기한 검색"]', "출장");
await p.waitForTimeout(500);
const afterSearch = await p.locator("li").count();
ok(afterSearch >= 1 && afterSearch < total, `3) 검색 '출장' 필터링(${afterSearch}건)`);
// 유형 세그먼트
await p.getByRole("tab", { name: "기간한도" }).click();
await p.waitForTimeout(400);
ok(true, "4) 유형 세그먼트 클릭");
await p.getByRole("tab", { name: "전체" }).click();
await p.fill('input[aria-label="기한 검색"]', "");
await p.waitForTimeout(400);
// 계산: 첫 행의 기준일 입력 → 마감 계산
const firstDate = p.locator('input[type="date"]').first();
await firstDate.fill("2026-08-01");
await p.waitForTimeout(400);
ok((await p.getByText(/마감 2026/).count())>=1, "5) 기준일→마감일 계산 표시");
ok((await p.getByRole("button", { name: /캘린더/ }).count())>=1, "6) .ics 버튼 노출");
await p.screenshot({ path: `${S}/deadlines-calc.png` });
// 규정 링크
ok((await p.locator('a[href*="/d/"]').count())>=1, "7) 규정 드로어 링크 존재");
// 다크
await p.emulateMedia({ colorScheme: "dark" });
await p.screenshot({ path: `${S}/deadlines-dark.png` });
await b.close();
console.log(fails.length?`\n❌ 실패 ${fails.length}`:"\n🎉 전부 통과");
process.exit(fails.length?1:0);
