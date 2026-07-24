// 상위법령 admrul 별표(연구개발비 고시) 서식 찾기 노출 검증 (dev 3101, docs/61 v3).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1240, height: 1400 } });
const r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: "test1234" } });
console.log("로그인:", r.status());
await ctx.route("**/app/flags**", (route) =>
  route.fulfill({ contentType: "application/json", body: JSON.stringify({ forms_registry: true }) }));
const p = await ctx.newPage();
await p.goto(`${BASE}/forms/`, { waitUntil: "networkidle" });
await p.waitForSelector("table tbody tr", { timeout: 10000 });
// 연구개발비 계상기준 별표 검색
await p.fill('input[aria-label="서식 검색"]', "연구개발비계상기준");
await p.waitForTimeout(500);
const rows = await p.locator("tbody tr").count();
const hasUplaw = await p.getByText("상위법령 · 국가연구개발사업 연구개발비 사용 기준", { exact: false }).count();
const hasTitle = await p.getByText("기본사업연구개발비계상기준", { exact: false }).count();
console.log(`✓ '연구개발비계상기준' 필터 · 행 ${rows} · 상위법령 라벨 ${hasUplaw} · 계상기준 별표 ${hasTitle}`);
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/uplaw-annex.png" });
// PDF 링크가 uplaw 경로인지
const pdfHref = await p.locator('a[href*="/forms-pdf/uplaw/"]').first().getAttribute("href").catch(() => null);
console.log("  PDF 링크:", pdfHref);
if (!hasUplaw || !hasTitle || !pdfHref) { console.error("❌ admrul 별표 노출 검증 실패"); process.exit(1); }
console.log("🎉 admrul 별표(연구개발비 고시) 서식 노출 검증 통과");
await b.close();
