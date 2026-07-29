// v1.1 P1 코퍼스 관리 검증 — 목록·검색·제외 토글·재색인 배지 (dev 3101, 관리자 admintest).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const ctx = await b.newContext();
let r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: TEST_USER, password: TEST_PW } });
ok(r.ok(), `0) 관리자 로그인 (${r.status()})`);
const p = await ctx.newPage({ viewport: { width: 1440, height: 1200 } });
await p.goto(`${BASE}/admin/#corpus`, { waitUntil: "load" }); // docs/21 탭 셸
await p.waitForTimeout(2500);
let body = await p.textContent("body");
ok(body.includes("코퍼스 관리"), "1) 코퍼스 관리 섹션 렌더");
ok(/전체 목록 \d+/.test(body) && /청크 \d+/.test(body), "2) 요약(목록·청크 수)");

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
// docs/21 §2: 제외하면 전체 목록에서 사라지고 🗂 제외 문서함으로 이동
ok((await p.locator('[class*="corpusRow"]').filter({ hasText: /^복무규정/ }).count()) === 0,
   "4) 제외 → 전체 목록에서 이동");
ok(body.includes("재색인 필요"), "5) ⟳ 재색인 필요 배지");
// exclude.json 실반영 확인(파일)
const fs = await import("fs");

// ⛔ 라이브 계정 비밀번호를 코드에 두지 않는다(보안 스캔 F1/F3/F12).
//    실행: APP_TEST_USER=... APP_TEST_PASS=... node <이 파일>
const TEST_USER = process.env.APP_TEST_USER || "admintest";
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — 검증 계정 비밀번호는 환경변수로만 받습니다.");
  process.exit(2);
}
const ex = JSON.parse(fs.readFileSync("../tools/index/exclude.json", "utf-8"));
ok(ex.excluded.includes("3400_복무규정"), `6) exclude.json 기록 (${JSON.stringify(ex.excluded)})`);
// 복귀(원복) — 제외 문서함 탭에서
await p.locator('button:has-text("제외 문서함")').click();
await p.waitForTimeout(600);
// 제외 문서함 행은 '⛔ 제외됨' 배지가 제목 앞 — 앵커 없이 매치(1차 실행에서 상태 오염 실측)
await p.locator('[class*="corpusRow"]').filter({ hasText: "복무규정" }).first().locator("button").click();
await p.waitForTimeout(1000);
const ex2 = JSON.parse(fs.readFileSync("../tools/index/exclude.json", "utf-8"));
ok(!ex2.excluded.includes("3400_복무규정"), "7) 복귀 토글 → exclude.json 원복");
await p.screenshot({ path: "verify-corpus-p1.png" });
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 코퍼스 관리 P1 검증 통과");
process.exit(fails.length ? 1 : 0);
