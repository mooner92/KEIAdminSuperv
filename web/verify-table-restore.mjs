// verify-table-restore.mjs — 표 복원 검수 탭 실렌더 검증 (docs/24 §1 수용기준 ⓐ·ⓒ)
// ⛔ 실제 [반영]은 클릭하지 않는다 — 반영은 사람의 승인 행위(E2E는 확인 대화상자 전까지).
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://127.0.0.1:3101";
const USER = process.env.APP_TEST_USER || "admintest";
const PW = process.env.APP_TEST_PASS || "admtest123";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
const r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: USER, password: PW } });
ok(r.ok(), `1) 로그인 (${r.status()})`);

const p = await ctx.newPage();
await p.goto(`${BASE}/admin/#restore`, { waitUntil: "load" });
await p.waitForTimeout(2500);

// 탭·목록 렌더
ok((await p.getByRole("tab", { name: /표 복원/ }).count()) > 0, "2) 🔧 표 복원 탭 렌더(플래그 on)");
await p.getByText("복무규정", { exact: false }).first().waitFor({ timeout: 20000 });
ok((await p.getByText(/자동 반영 가능/).count()) > 0, "3) '자동 반영 가능' 상태 배지");
ok((await p.getByText(/수동 필요/).count()) > 0, "4) '수동 필요' 상태 배지(평탄화 문서)");

// 복무규정 펼치기 → 손상 표본 vs 복원 표 대비
await p.locator("li", { hasText: "복무규정" }).first().locator("b").first().click();
await p.waitForTimeout(600);
ok((await p.getByText("기존 볼트의 손상 표본").count()) > 0, "5) 손상 표본(before) 렌더");
const cellOk = (await p.locator("td", { hasText: "본    인" }).count()) > 0
  || (await p.locator("td", { hasText: "본 인" }).count()) > 0;
ok(cellOk, "6) 복원 표(after) 셀 줄바꿈 렌더(본인/자녀 분리)");

// 반영 버튼: 존재 + 확인 대화상자까지만(⛔반영 안 함)
let dialogSeen = false;
p.on("dialog", async (d) => { dialogSeen = true; await d.dismiss(); });
const btn = p.locator("li", { hasText: "복무규정" }).first().locator("button.Admin_applyBtn__sNPG_, button[title*=\"볼트에 반영\"]").first();
ok((await btn.count()) > 0 && !(await btn.isDisabled()), "7) [반영] 버튼 활성(자동 가능 문서)");
await btn.click();
await p.waitForTimeout(500);
ok(dialogSeen, "8) 확인 대화상자 표시 → 취소(실반영 없음)");
const list = await ctx.request.get(`${BASE}/api/app/corpus/table-restore`);
const applied = (await list.json()).docs.find((d) => d.name === "복무규정").applied_at;
ok(!applied, "9) 취소 후 반영 이력 없음(볼트 불변)");

await p.screenshot({ path: "verify-table-restore.png", fullPage: false });
await b.close();
console.log(`\n${fails.length === 0 ? "✅ 전부 통과" : `❌ 실패 ${fails.length}건`} — 표 복원 검수 탭`);
process.exit(fails.length === 0 ? 0 : 1);
