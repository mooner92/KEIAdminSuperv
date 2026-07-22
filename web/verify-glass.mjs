import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const S = "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad";
const fails=[]; const ok=(c,m)=>{console.log((c?"✅ ":"❌ ")+m);if(!c)fails.push(m)};
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1200, height: 950 } });
await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: "test1234" } });
await ctx.route("**/app/flags", async (r)=>{const res=await r.fetch();const f=await res.json();r.fulfill({contentType:"application/json",body:JSON.stringify({...f,reader_glass:true})});});
const p = await ctx.newPage();
// 조밀한 규정 문서 하나 열기
await p.goto(`${BASE}/d/${encodeURIComponent("3400_복무규정")}/`, { waitUntil: "networkidle" });
await p.waitForSelector("article", { timeout: 10000 });
await p.waitForTimeout(600);
// 토글 존재
const toggle = p.getByRole("button", { name: /돋보기/ });
ok(await toggle.count() >= 1, "1) 돋보기 토글 노출(flag on)");
await toggle.click();
await p.waitForTimeout(300);
// 본문 위로 커서 이동 → 렌즈 나타남
const art = p.locator("article").first();
const box = await art.boundingBox();
await p.mouse.move(box.x + box.width/2, box.y + 220);
await p.waitForTimeout(400);
const lensCount = await p.locator('div[class*="lens"]').count();
ok(lensCount >= 1, "2) 커서 위 렌즈 표시");
// 확대 복제본에 본문 텍스트가 들어있는지
const cloneText = await p.locator('div[class*="clone"]').first().innerText().catch(()=>"");
ok(cloneText.length > 30, `3) 렌즈 안에 확대 본문(${cloneText.length}자)`);
await p.screenshot({ path: `${S}/glass-light.png` });
// 커서 다른 위치로 → 렌즈 따라오는지
await p.mouse.move(box.x + box.width/2, box.y + 400);
await p.waitForTimeout(300);
await p.screenshot({ path: `${S}/glass-light2.png` });
// 본문 밖으로 → 렌즈 사라짐
await p.mouse.move(20, 20);
await p.waitForTimeout(300);
const vis = await p.locator('div[class*="lens"]').first().evaluate((el)=>getComputedStyle(el).visibility);
ok(vis === "hidden", `4) 본문 밖에선 렌즈 숨김(visibility=${vis})`);
// 다크
await p.emulateMedia({ colorScheme: "dark" });
await p.addInitScript(()=>{});
await p.mouse.move(box.x + box.width/2, box.y + 260);
await p.waitForTimeout(300);
await p.screenshot({ path: `${S}/glass-dark.png` });
await b.close();
console.log(fails.length?`\n❌ 실패 ${fails.length}`:"\n🎉 전부 통과");
process.exit(fails.length?1:0);
