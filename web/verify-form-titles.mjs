// PMS 표시명 정리(영문 런온 제거) + DOCX 분량 배지 검증 (dev 3101).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1160, height: 700 } });
await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: "test1234" } });
await ctx.route("**/app/flags**", (r) => r.fulfill({ contentType:"application/json", body: JSON.stringify({ forms_registry: true }) }));
const p = await ctx.newPage();
await p.goto(`${BASE}/forms/`, { waitUntil: "networkidle" });
await p.waitForSelector("table tbody tr");
await p.fill('input[aria-label="서식 검색"]', "연구윤리준수확인서");
await p.waitForTimeout(700);
await p.screenshot({ path: "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad/forms-fixed.png" });
console.log("캡처 완료");
await b.close();
