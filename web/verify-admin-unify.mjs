// 관리자 화면 공용 컴포넌트 통일 검증(specs/03 B2·B3) — DataTable·SearchInput 실렌더.
import { chromium } from "playwright";

// ⛔ 테스트 계정 비밀번호를 코드에 두지 않는다(보안 스캔 후속 — dev 계정 14개가
//    레포에 박힌 비밀번호로 열리던 것을 2026-07-29에 회전).
//    실행: set -a; . tools/.test_credentials; set +a; node <이 파일>
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — tools/.test_credentials 를 로드하세요.");
  process.exit(2);
}
const BASE = "http://localhost:3101";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
console.log("로그인:", (await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "admintest", password: TEST_PW } })).status());
const p = await ctx.newPage();
let bad = 0;
for (const [tab, label] of [["dashboard", "대시보드"], ["users", "사용자"], ["trust", "신뢰"], ["usage", "통계"],
  ["corpus", "코퍼스 관리"], ["flags", "기능 플래그"], ["restore", "표 복원"], ["reports", "의견함"], ["faq", "FAQ 브리지"]]) {
  await p.goto(`${BASE}/admin/`, { waitUntil: "networkidle" });
  await p.waitForTimeout(600);
  const btn = p.getByRole("tab", { name: new RegExp(label) }).first();
  if (await btn.count()) { await btn.click(); await p.waitForTimeout(1500); }
  else console.log(`    ⚠ 탭 못 찾음: ${label}`);
  const dt = await p.locator('[class*="DataTable_table"]').count();
  const si = await p.locator('[class*="SearchInput_"]').count();
  const legacy = await p.locator('table:not([class*="DataTable_"]), [class*="corpusSearch"]').count();
  const sec = await p.locator('[class*="Section_section"]').count();
  console.log(`  ${label}: Section ${sec} · DataTable ${dt} · SearchInput ${si} · 레거시 ${legacy}`);
  if (sec === 0) { console.log(`    ⚠ Section 없음`); bad++; }
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
