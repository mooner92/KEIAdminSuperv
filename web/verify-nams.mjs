// NAMS(대외업무관리시스템) 적재 실렌더 검증 (dev 3101).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });

await p.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
let body = await p.textContent("body");
ok(body.includes("대외업무(NAMS)"), "1) 둘러보기 분류 필터 '대외업무(NAMS)' 생성");
await p.locator('input[aria-label="검색"]').first().fill("대외업무 시스템");
await p.waitForTimeout(900);
body = await p.textContent("body");
ok(body.includes("대외업무 시스템 · 요구자료"), "2) NAMS 모듈 노트 목록 노출");
await p.getByText("대외업무 시스템 · 요구자료", { exact: true }).first().click();
await p.waitForTimeout(1200);
const d = await p.locator('[aria-label="문서 보기"]').textContent();
ok(d.includes("대외요구자료") && d.includes("취합게시판"), "3) 드로어 본문(요구자료 현황·취합게시판) 렌더");
ok(d.includes("관련 규정"), "4) 규정 교차링크 섹션 렌더");
await p.screenshot({ path: "verify-nams.png" });
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ NAMS 적재 검증 통과");
process.exit(fails.length ? 1 : 0);
