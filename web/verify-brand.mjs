// 브랜드 이야기(/brand) 실렌더 검증 — 플래그 on/off 양쪽 + 푸터 진입 + 다크.
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const OUT = "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
const r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: "test1234" } });
console.log("로그인:", r.status());
let fail = 0;
const flags = (on) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ brand_page: on }) });

// ① off — '준비 중' 폴백(정적 export 관례)
const p0 = await ctx.newPage();
await p0.route("**/app/flags**", flags(false));
await p0.goto(`${BASE}/brand/`, { waitUntil: "networkidle" });
await p0.waitForTimeout(1200);
const offTxt = await p0.locator("body").innerText();
const offOk = /준비 중/.test(offTxt) && !/호롱불처럼/.test(offTxt);
console.log(`  flag off → ${offOk ? "✅ 준비 중 폴백" : "❌ 폴백 실패"}`);
if (!offOk) fail++;
const footOff = await p0.locator('a[href="/brand/"]').count(); // v2: 푸터→사이드바 하단
console.log(`  flag off → 푸터 링크 ${footOff === 0 ? "✅ 숨김" : "❌ 노출"}`);
if (footOff) fail++;

// ② on — 본문 + 푸터 진입
const p = await ctx.newPage();
await p.route("**/app/flags**", flags(true));
await p.goto(`${BASE}/brand/`, { waitUntil: "networkidle" });
await p.waitForTimeout(1400);
const txt = await p.locator("body").innerText();
for (const kw of ["호롱불", "물방울", "잎", "화면을 만들 때 지키는 것", "색만으로 알리지 않습니다"]) {
  const ok = txt.includes(kw);
  if (!ok) { console.log(`  ❌ 문구 누락: ${kw}`); fail++; }
}
const marks = await p.locator('svg[aria-label="호롱"]').count();
const cards = await p.locator('[class*="Brand_card__"]').count();
const prin = await p.locator('[class*="Brand_principle__"]').count();
console.log(`  본문: 심볼 ${marks}개 · 의미카드 ${cards} · 원칙 ${prin}`);
if (cards !== 3 || prin !== 6) { console.log("  ❌ 카드/원칙 개수"); fail++; }
// ⛔ 사용자 언어 계약 — 내부 구현 용어가 새면 안 된다
const leak = ["globals.css", "--color-", "web/", "docs/", "tsx"].filter((k) => txt.includes(k));
console.log(`  사용자 언어: ${leak.length === 0 ? "✅ 내부 용어 0" : "❌ " + leak.join(", ")}`);
if (leak.length) fail++;
// 푸터 진입
const foot = p.locator('a[href="/brand/"]');
if (await foot.count()) {
  await foot.first().click();
  await p.waitForTimeout(900);
  console.log(`  푸터 진입: ✅ ${new URL(p.url()).pathname}`);
} else { console.log("  ❌ 푸터 링크 없음"); fail++; }
await p.screenshot({ path: `${OUT}/brand-light.png`, fullPage: true });

// ③ 다크 — 토큰 분기 확인(하드코딩 색이 있으면 대비가 깨진다)
await p.emulateMedia({ colorScheme: "dark" });
await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(1200);
const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
const dark = /rgb\((\d+), (\d+), (\d+)\)/.exec(bg);
const isDark = dark && Number(dark[1]) < 80;
console.log(`  다크: body bg ${bg} ${isDark ? "✅" : "❌"}`);
if (!isDark) fail++;
await p.screenshot({ path: `${OUT}/brand-dark.png`, fullPage: true });
await b.close();
console.log(fail ? `⛔ 실패 ${fail}건` : "🎉 브랜드 페이지 검증 통과");
process.exit(fail ? 1 : 0);
