// docs/20·24·34 수용기준 갭 3종 실렌더 검증 — 레이더 문서 링크·재색인 필요(스테일)·웹 반영 고지.
import { chromium } from "playwright";
import fs from "node:fs";

// ⛔ 라이브 계정 비밀번호를 코드에 두지 않는다(보안 스캔 F1/F3/F12).
//    실행: APP_TEST_USER=... APP_TEST_PASS=... node <이 파일>
const TEST_USER = process.env.APP_TEST_USER || "admintest";
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — 검증 계정 비밀번호는 환경변수로만 받습니다.");
  process.exit(2);
}
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const STALE = "/home/mhchoi/kei-dev-0703/tools/index/reindex_stale.json";
const b = await chromium.launch();
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log((ok ? "✅" : "❌") + " " + n + (d ? " — " + d : "")); ok ? pass++ : fail++; };

const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.request.post(BASE + "/api/app/auth/login", { data: { username: TEST_USER, password: TEST_PW } });
const p = await ctx.newPage();

// ① docs/34: 신뢰 레이더 규정명 → /d/ 링크 (백필 포함)
await p.goto(BASE + "/admin/#trust", { waitUntil: "load" });
await p.waitForTimeout(2500);
const radarTable = p.locator("table").first(); // 첫 표 = 레이더
const radarLinks = await radarTable.locator('a[href^="/d/"]').count();
check("① 레이더 근거 규정명이 /d/ 링크", radarLinks > 0, `${radarLinks}개`);
if (radarLinks > 0) {
  const href = await radarTable.locator('a[href^="/d/"]').first().getAttribute("href");
  await radarTable.locator('a[href^="/d/"]').first().click();
  await p.waitForTimeout(1500);
  check("① 링크 클릭 → 문서 페이지 도달", decodeURIComponent(p.url()).includes("/d/"), decodeURIComponent(href || ""));
  await p.goBack({ waitUntil: "load" });
  await p.waitForTimeout(1500);
}

// ② docs/20: 재색인 바에 '웹 반영은 다음 배포에' 고지
await p.goto(BASE + "/admin/#corpus", { waitUntil: "load" });
await p.waitForTimeout(2500);
const corpusBody = await p.innerText("body");
check("② 재색인 고지(검색 즉시·웹은 다음 배포)", corpusBody.includes("다음 웹 재빌드") && corpusBody.includes("검색(챗봇 근거)에 즉시"));

// ③ docs/24 ⓓ: 스테일 문서가 '⟳ 재색인 필요'로 표시 — 스테일 파일에 실제 슬러그 주입(비파괴) 후 확인
const staleBefore = fs.existsSync(STALE) ? fs.readFileSync(STALE, "utf-8") : null;
fs.writeFileSync(STALE, JSON.stringify({ stale: ["3400_복무규정"] }), "utf-8");
try {
  const r = await ctx.request.get(BASE + "/api/app/corpus");
  const j = await r.json();
  const doc = j.docs.find((d) => d.slug === "3400_복무규정");
  check("③ 스테일 슬러그 needs_reindex=true(API)", !!doc && doc.needs_reindex === true, JSON.stringify({ chunks: doc?.chunks, needs: doc?.needs_reindex }));
  check("③ summary 재색인 필요 반영", j.summary.needs_reindex >= 1, String(j.summary.needs_reindex));
  // UI: 검색해서 배지 확인
  await p.reload({ waitUntil: "load" });
  await p.waitForTimeout(2500);
  await p.locator('input[aria-label="코퍼스 검색"]').fill("복무규정");
  await p.waitForTimeout(600);
  const rowTxt = await p.locator('[class*="corpusRow"]').filter({ hasText: "복무규정" }).first().innerText();
  check("③ UI '⟳ 재색인 필요' 배지", rowTxt.includes("재색인 필요"), rowTxt.replace(/\s+/g, " ").slice(0, 60));
} finally {
  // 원상 복구
  if (staleBefore === null) fs.rmSync(STALE, { force: true });
  else fs.writeFileSync(STALE, staleBefore, "utf-8");
}
const r2 = await ctx.request.get(BASE + "/api/app/corpus");
const j2 = await r2.json();
check("③ 복구 후 스테일 해제", (j2.docs.find((d) => d.slug === "3400_복무규정") || {}).needs_reindex === false);
await p.screenshot({ path: "verify-spec-gaps.png" });

console.log(`\n${pass}/${pass + fail} 판정 통과`);
await b.close();
process.exit(fail ? 1 : 0);
