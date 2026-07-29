// verify-table-restore.mjs — 표 복원 검수 탭 실렌더 검증 (docs/24 §1 수용기준 ⓐ·ⓒ)
// ⛔ 실제 [반영]은 클릭하지 않는다 — 반영은 사람의 승인 행위(E2E는 확인 대화상자 전까지).
import { chromium } from "playwright";

// ⛔ 라이브 계정 비밀번호를 코드에 두지 않는다(보안 스캔 F1/F3/F12).
//    실행: set -a; . tools/.test_credentials; set +a; node <이 파일>
//    ⛔ admintest는 실재하지 않는 계정이다 — 기본값은 상주 픽스처 b6test.
//       관리자 화면(/admin) 테스트는 APP_TEST_USER=<APP_ADMINS 계정>을 함께 지정할 것.
const TEST_USER = process.env.APP_TEST_USER || "b6test";
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — 검증 계정 비밀번호는 환경변수로만 받습니다.");
  process.exit(2);
}

const BASE = process.env.BASE || "http://127.0.0.1:3101";
const USER = TEST_USER;
const PW = TEST_PW;
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
const r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: USER, password: PW } });
ok(r.ok(), `1) 로그인 (${r.status()})`);

const p = await ctx.newPage();
await p.goto(`${BASE}/admin/#restore`, { waitUntil: "load" });
await p.waitForTimeout(2500);

// 탭·목록 렌더. ⚠ 상태 의존 기대값(docs/28에서 복무규정 등 4건 실반영됨 — 사람 승인):
//    반영 전 = '자동 반영 가능' 배지 + 버튼 활성 / 반영 후 = '반영됨' 배지 + matchable 0 → 버튼 비활성(멱등).
ok((await p.getByRole("tab", { name: /표 복원/ }).count()) > 0, "2) 🔧 표 복원 탭 렌더(플래그 on)");
await p.getByText("복무규정", { exact: false }).first().waitFor({ timeout: 20000 });
const list0 = await (await ctx.request.get(`${BASE}/api/app/corpus/table-restore`)).json();
const bokmu = list0.docs.find((d) => d.name === "복무규정");
ok((await p.getByText(/자동 반영 가능|반영됨/).count()) > 0, "3) 상태 배지(자동 반영 가능 또는 반영됨)");
ok((await p.getByText(/수동 필요/).count()) > 0, "4) '수동 필요' 상태 배지(평탄화 문서)");

// 복무규정 펼치기 → 손상 표본 vs 복원 표 대비
await p.locator("li", { hasText: "복무규정" }).first().locator("b").first().click();
await p.waitForTimeout(600);
ok((await p.getByText("기존 볼트의 손상 표본").count()) > 0, "5) 손상 표본(before) 렌더");
const cellOk = (await p.locator("td", { hasText: "본    인" }).count()) > 0
  || (await p.locator("td", { hasText: "본 인" }).count()) > 0;
ok(cellOk, "6) 복원 표(after) 셀 줄바꿈 렌더(본인/자녀 분리)");

const btn = p.locator("li", { hasText: "복무규정" }).first().locator('button[title*="반영"]').first();
if (bokmu?.applied_at || bokmu?.matchable === 0) {
  // 반영 후 정상 상태: 반영됨 배지 + 버튼 비활성(재반영 멱등 보호) + 이력 보존
  ok((await p.locator("li", { hasText: "복무규정" }).first().getByText(/반영됨/).count()) > 0, "7) '반영됨' 배지(반영 후 상태)");
  ok((await btn.count()) > 0 && (await btn.isDisabled()), "8) [반영] 버튼 비활성(matchable 0 — 멱등)");
  ok(!!bokmu.applied_at, "9) 반영 이력(applied_at) 보존");
} else {
  // 반영 전 상태: 버튼 활성 + 확인 대화상자까지만(⛔실반영 없음)
  let dialogSeen = false;
  p.on("dialog", async (d) => { dialogSeen = true; await d.dismiss(); });
  ok((await btn.count()) > 0 && !(await btn.isDisabled()), "7) [반영] 버튼 활성(자동 가능 문서)");
  await btn.click();
  await p.waitForTimeout(500);
  ok(dialogSeen, "8) 확인 대화상자 표시 → 취소(실반영 없음)");
  const applied = (await (await ctx.request.get(`${BASE}/api/app/corpus/table-restore`)).json())
    .docs.find((d) => d.name === "복무규정").applied_at;
  ok(!applied, "9) 취소 후 반영 이력 없음(볼트 불변)");
}

await p.screenshot({ path: "verify-table-restore.png", fullPage: false });
await b.close();
console.log(`\n${fails.length === 0 ? "✅ 전부 통과" : `❌ 실패 ${fails.length}건`} — 표 복원 검수 탭`);
process.exit(fails.length === 0 ? 0 : 1);
