// 서식 찾기 분량 배지 검증 — '한 장'(1쪽)/'N장'(다쪽) (dev 3101). forms_registry는 route로 강제 on.
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1240, height: 1500 } });
const r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: "test1234" } });
console.log("로그인:", r.status());
await ctx.route("**/app/flags**", (route) =>
  route.fulfill({ contentType: "application/json", body: JSON.stringify({ forms_registry: true }) }));
const p = await ctx.newPage();
await p.goto(`${BASE}/forms/`, { waitUntil: "networkidle" });
await p.waitForSelector("table tbody tr", { timeout: 10000 });
const one = await p.getByText("한 장", { exact: true }).count();
const many = await p.locator("tbody span").filter({ hasText: /^\d+장$/ }).count();
console.log(`✓ 표 렌더 · '한 장' 배지 ${one} · 'N장' 배지 ${many}`);
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/forms-byeolji.png" });
await p.fill('input[aria-label="서식 검색"]', "정보보안 기본지침");
await p.waitForTimeout(500);
const oneF = await p.getByText("한 장", { exact: true }).count();
const manyF = await p.locator("tbody span").filter({ hasText: /^\d+장$/ }).count();
console.log(`✓ '정보보안 기본지침' 필터 · '한 장' ${oneF} · 'N장' ${manyF}`);
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/forms-multi.png" });
await b.close();
