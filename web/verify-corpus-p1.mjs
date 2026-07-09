// v1.1 P1 코퍼스 관리 검증 — 목록·검색·제외 토글·재색인 배지 (dev 3101, 관리자 admintest).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const ctx = await b.newContext();
let r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "admintest", password: "admtest123" } });
ok(r.ok(), `0) 관리자 로그인 (${r.status()})`);
const p = await ctx.newPage({ viewport: { width: 1440, height: 1200 } });
await p.goto(`${BASE}/admin/`, { waitUntil: "load" });
await p.waitForTimeout(2500);
let body = await p.textContent("body");
ok(body.includes("코퍼스 관리"), "1) 코퍼스 관리 섹션 렌더");
ok(/문서 \d+ · 청크 \d+/.test(body), "2) 요약(문서·청크 수)");

// 검색 + 토글
await p.locator('input[aria-label="코퍼스 검색"]').fill("복무규정");
await p.waitForTimeout(500);
const row = p.locator('[class*="corpusRow"]').filter({ hasText: /^복무규정/ }).first();
ok((await row.count()) > 0, "3) 검색 결과 행");
await row.locator("button").click(); // 색인 제외
await p.waitForTimeout(1200);
await p.locator('input[aria-label="코퍼스 검색"]').fill("복무규정");
await p.waitForTimeout(500);
body = await p.textContent("body");
ok(body.includes("제외됨 → 복귀"), "4) 제외 토글 반영");
ok(body.includes("재색인 필요"), "5) ⟳ 재색인 필요 배지");
// exclude.json 실반영 확인(파일)
const fs = await import("fs");
const ex = JSON.parse(fs.readFileSync("../tools/index/exclude.json", "utf-8"));
ok(ex.excluded.includes("3400_복무규정"), `6) exclude.json 기록 (${JSON.stringify(ex.excluded)})`);
// 복귀(원복)
await p.locator('[class*="corpusRow"]').filter({ hasText: /^복무규정/ }).first().locator("button").click();
await p.waitForTimeout(1000);
const ex2 = JSON.parse(fs.readFileSync("../tools/index/exclude.json", "utf-8"));
ok(!ex2.excluded.includes("3400_복무규정"), "7) 복귀 토글 → exclude.json 원복");
await p.screenshot({ path: "verify-corpus-p1.png" });
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 코퍼스 관리 P1 검증 통과");
process.exit(fails.length ? 1 : 0);
