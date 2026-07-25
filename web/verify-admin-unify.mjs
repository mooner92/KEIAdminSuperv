// 관리자 화면 공용 컴포넌트 통일 검증(specs/03 B2·B3) — DataTable·SearchInput 실렌더.
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
console.log("로그인:", (await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "admintest", password: "test1234" } })).status());
const p = await ctx.newPage();
let bad = 0;
for (const [tab, label] of [["users", "사용자"], ["trust", "신뢰"], ["usage", "통계"], ["corpus", "코퍼스 관리"], ["flags", "기능 플래그"]]) {
  await p.goto(`${BASE}/admin/`, { waitUntil: "networkidle" });
  await p.waitForTimeout(600);
  const btn = p.getByRole("tab", { name: new RegExp(label) }).first();
  if (await btn.count()) { await btn.click(); await p.waitForTimeout(1500); }
  else console.log(`    ⚠ 탭 못 찾음: ${label}`);
  const dt = await p.locator('[class*="DataTable_table"]').count();
  const si = await p.locator('[class*="SearchInput_"]').count();
  const legacy = await p.locator('table:not([class*="DataTable_"]), [class*="corpusSearch"]').count();
  console.log(`  ${label}: DataTable ${dt} · SearchInput ${si} · 레거시 ${legacy}`);
  if (legacy > 0) bad++;
  await p.screenshot({ path: `/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/admin-${tab}.png` });
}
// 품질 게시판 추이표
await p.goto(`${BASE}/quality/`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
console.log(`  품질 추이표: DataTable ${await p.locator('[class*="DataTable_table"]').count()} · 레거시 ${await p.locator('[class*="trendTable"]').count()}`);
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/quality-table.png" });
await b.close();
process.exit(bad ? 1 : 0);
