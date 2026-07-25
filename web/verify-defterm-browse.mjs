// 규정정의 용어 노트·허브의 둘러보기 노출 검증 (specs/02 Full-Vault, dev 3101)
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 1500 } });
console.log("로그인:", (await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: "test1234" } })).status());
const p = await ctx.newPage();
// ① 둘러보기에서 '규정 용어 사전' 검색
await p.goto(`${BASE}/browse/`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
const search = p.locator('input[type="search"], input[placeholder*="검색"], input[aria-label*="검색"]').first();
await search.waitFor({ state: "visible", timeout: 10000 });
await search.fill("규정 용어 사전");
await p.waitForTimeout(800);
const hub = await p.getByText("규정 용어 사전", { exact: false }).count();
console.log(hub > 0 ? "✅ 허브 '규정 용어 사전' 검색 노출" : "❌ 허브 미노출");
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/browse-defterm.png" });
// ② 허브 문서 열기 → 링크·충돌 섹션 확인
await p.goto(`${BASE}/d/${encodeURIComponent("규정 용어 사전")}/`, { waitUntil: "networkidle" });
const conflictSec = await p.getByText("규정마다 다르게 정의된 용어", { exact: false }).count();
const regSec = await p.getByText("규정별 정의 용어", { exact: false }).count();
console.log(conflictSec > 0 ? "✅ 충돌 섹션" : "❌ 충돌 섹션 없음", regSec > 0 ? "· ✅ 규정별 섹션" : "· ❌ 규정별 섹션 없음");
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/hub-note.png" });
// ③ 개별 용어(충돌 사례) 노트
await p.goto(`${BASE}/d/${encodeURIComponent("전자문서")}/`, { waitUntil: "networkidle" });
const warn = await p.getByText("정의 충돌", { exact: false }).count();
const quotes = await p.getByText("규정 원문 —", { exact: false }).count();
console.log(warn > 0 ? `✅ 충돌 경고 + 정의 ${quotes}건 병기` : "❌ 충돌 경고 없음");
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/term-conflict.png" });
if (!hub || !conflictSec || !warn) { console.error("❌ 검증 실패"); process.exit(1); }
console.log("🎉 규정정의 노트 둘러보기 노출 검증 통과");
await b.close();
