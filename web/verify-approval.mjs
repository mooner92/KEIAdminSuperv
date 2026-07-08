// Track B 결재선 판정기 v2 실렌더 검증 (dev 3101):
// ① 상단 메뉴 '결재선' + 독립 페이지(/approval) ② 직급 드롭다운 정화(진짜 직급 7개만)
// ③ 조건(금액구간)은 업무 경로에 편입 ④ 직급 localStorage 기억 ⑤ 위임전결규정 드로어→링크 카드.
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1300 } });

const flags = await (await p.request.get(`${BASE}/api/app/flags`)).json();
ok(flags.approval_finder === true, "1) approval_finder 플래그 on");

// ① 독립 페이지 + 상단 메뉴
await p.goto(`${BASE}/approval/`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
let body = await p.textContent("body");
ok(body.includes("결재선 판정기") && body.includes("부서에서 확인"), "2) /approval 페이지 + 면책 렌더");
ok((await p.locator('nav >> text=결재선').count()) > 0, "3) 상단 메뉴에 '결재선' 노출");

// ② 직급 드롭다운 정화 — 진짜 직급만 (금액구간·문서종류 없어야)
const opts = await p.locator('select[aria-label="신청자 직급"] option').allTextContents();
const badOpts = opts.filter((o) => /만원|평가서|중요한 사항|부서간|부서내|신청$|계획 수립/.test(o));
ok(badOpts.length === 0, `4) 드롭다운에 비직급 값 없음 (옵션 ${opts.length}개: ${opts.slice(1).join("·")})`);
ok(opts.length <= 9, "5) 직급 옵션 수 정상(전체+7직급 이내)");

// ③ 조건 편입 — '가지급금' 검색 시 금액구간이 업무 경로에 보임
await p.locator('input[aria-label="업무 검색"]').fill("가지급금");
await p.waitForTimeout(500);
body = await p.textContent("body");
ok(/200만원 이하/.test(body) && /전결/.test(body), "6) 금액구간이 업무 경로에 편입되어 결과 표시");

// ④ 직급 선택 → localStorage 기억
await p.locator('select[aria-label="신청자 직급"]').selectOption({ label: "일반직원" });
await p.waitForTimeout(300);
const saved = await p.evaluate(() => localStorage.getItem("kei-approval-role"));
ok(saved === "일반직원", "7) 직급 선택이 localStorage에 기억됨");
await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(1200);
const roleVal = await p.locator('select[aria-label="신청자 직급"]').inputValue();
ok(roleVal === "일반직원", "8) 새로고침 후에도 직급 유지");

// 출장+일반직원 → 실·팀장 전결 (별표 정합)
await p.locator('input[aria-label="업무 검색"]').fill("국내 출장");
await p.waitForTimeout(500);
body = await p.textContent("body");
ok(/실･팀장|실·팀장/.test(body), "9) 국내출장·일반직원 → 실·팀장 전결 표시");
await p.screenshot({ path: "verify-approval-page.png" });

// ⑤ 위임전결규정 드로어 — 판정기 대신 링크 카드
await p.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
await p.locator('input[aria-label="검색"]').first().fill("위임전결규정");
await p.waitForTimeout(900);
await p.getByText("위임전결규정", { exact: true }).first().click();
await p.waitForTimeout(1200);
body = await p.locator('[aria-label="문서 보기"]').textContent();
ok(body.includes("결재선 판정기 열기"), "10) 위임전결규정 드로어에 판정기 링크 카드");

await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 결재선 판정기 v2 검증 통과");
process.exit(fails.length ? 1 : 0);
