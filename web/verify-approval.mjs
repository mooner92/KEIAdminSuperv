// docs/36 §10 — 관리자 승인제 실렌더: 가입 신청 → 승인 대기 UI → 관리자 승인 → 로그인.
import { chromium } from "playwright";
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const b = await chromium.launch();
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log((ok ? "✅" : "❌") + " " + n + (d ? " — " + d : "")); ok ? pass++ : fail++; };
const email = `apprtest_${Date.now()}@kei.re.kr`;

// ① 가입 신청 → '승인 대기' 안내(코드 입력칸 없음)
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
await p.goto(BASE + "/", { waitUntil: "load" });
await p.waitForTimeout(1500);
await p.locator("button", { hasText: "회원가입" }).first().click();
await p.waitForTimeout(400);
await p.locator('input[autocomplete="username"]').fill(email);
await p.locator('input[type="password"]').fill("pw123456");
await p.locator('button[type="submit"]', { hasText: "가입 신청" }).click();
const pending = await p.waitForFunction(() => document.body.innerText.includes("가입 신청이 접수") || document.body.innerText.includes("관리자 승인"),
  undefined, { timeout: 6000 }).then(() => true).catch(() => false);
check("① 가입 신청 → 승인 대기 안내", pending);
check("① 코드 입력칸 없음", (await p.locator('input[inputmode="numeric"]').count()) === 0);

// ② 미승인 로그인 시도 → '승인 대기 중' 메시지
await p.locator("button", { hasText: "로그인 화면으로" }).first().click();
await p.waitForTimeout(400);
await p.locator('input[autocomplete="username"]').fill(email);
await p.locator('input[type="password"]').fill("pw123456");
await p.locator('button[type="submit"]', { hasText: "로그인" }).click();
const waitMsg = await p.waitForFunction(() => document.body.innerText.includes("승인 대기 중"),
  undefined, { timeout: 6000 }).then(() => true).catch(() => false);
check("② 미승인 로그인 → 승인 대기 안내", waitMsg);
await ctx.close();

// ③ 관리자 승인 → 로그인 성공
const adm = await b.newContext({ viewport: { width: 1440, height: 1000 } });
await adm.request.post(BASE + "/api/app/auth/login", { data: { username: "admintest", password: "admtest123" } });
const pa = await adm.newPage();
await pa.goto(BASE + "/admin/#users", { waitUntil: "load" });
await pa.waitForTimeout(2000);
check("③ 승인 대기 카운트 노출", (await pa.innerText("body")).includes("승인 대기"));
const row = pa.locator("tr", { hasText: email });
check("③ 대기 사용자 행 + 승인 버튼", (await row.locator('button:has-text("승인")').count()) === 1);
await row.locator('button:has-text("승인")').first().click();
await pa.waitForTimeout(1500);
const approved = await pa.locator("tr", { hasText: email }).innerText();
check("③ 승인 후 '인증됨'", approved.includes("인증됨"), approved.replace(/\s+/g, " ").slice(0, 60));
await adm.close();

// ④ 승인 후 실제 로그인 성공
const c2 = await b.newContext();
const r = await c2.request.post(BASE + "/api/app/auth/login", { data: { username: email, password: "pw123456" } });
check("④ 승인 후 로그인 성공", r.ok(), String(r.status()));
await adm.close?.();

console.log(`\n${pass}/${pass + fail} 판정 통과`);
await b.close();
process.exit(fail ? 1 : 0);
