// Track B 결재선 판정기 v3 실렌더 검증 (dev 3101) — 규정 둘러보기와 동일 UX:
// ① 좌측 체크박스 필터(직급·구분·전결권자, 패싯 카운트) ② 검색 범위 태그 ③ 페이지네이션
// ④ 공백 무시 검색 ⑤ 직급 체크 localStorage 기억 ⑥ 위임전결규정 드로어 링크 카드.
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1300 } });

const flags = await (await p.request.get(`${BASE}/api/app/flags`)).json();
ok(flags.approval_finder === true, "1) approval_finder 플래그 on");

await p.goto(`${BASE}/approval/`, { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
let body = await p.textContent("body");
ok(body.includes("결재선 판정기") && body.includes("부서에서 확인"), "2) /approval 페이지 + 면책 렌더");
ok((await p.locator('nav >> text=결재선').count()) > 0, "3) 상단 메뉴에 '결재선' 노출");

// ① 좌측 필터 — 둘러보기와 동일한 구조(필터/그룹/체크박스+카운트)
ok(body.includes("필터") && body.includes("신청자 직급") && body.includes("전결권자"), "4) 좌측 필터 패널(직급·구분·전결권자 그룹)");
const roleLabels = await p.locator("aside label", { hasText: /부원장|부서장|팀장|일반직원|정규직/ }).allTextContents();
const badRoles = roleLabels.filter((o) => /만원|평가서|중요한 사항|부서간|부서내/.test(o));
ok(badRoles.length === 0 && roleLabels.length >= 6, `5) 직급 체크박스 정화(${roleLabels.length}개, 비직급 값 0)`);

// ② 검색 범위 태그(업무·구분·전결권자)
ok((await p.locator('[aria-label="검색 범위"] button').count()) === 3, "6) 검색 범위 태그 3종(업무·구분·전결권자)");

// ③ 페이지네이션 — 335건이면 페이지 이동 UI 존재
body = await p.textContent("body");
ok(/\d+건/.test(body) && body.includes("개씩"), "7) 건수 + 페이지 크기(10/30/50) UI");

// ④ 공백 무시 검색: '국내출장' == '국내 출장'
const countOf = async (kw) => {
  const box = p.locator('input[aria-label="업무 검색"]');
  await box.fill(kw);
  await p.waitForTimeout(450);
  const t = await p.locator("main").textContent();
  const m = t.match(/(\d+)건/);
  return m ? parseInt(m[1], 10) : -1;
};
const spaced = await countOf("국내 출장");
const joined = await countOf("국내출장");
ok(joined > 0 && joined === spaced, `8) 공백 무시 검색: '국내출장'=${joined} == '국내 출장'=${spaced}`);

// ⑤ 직급 체크 → localStorage 기억(kei-approval-roles) + 새로고침 유지 + 별표 정합
await p.locator("aside label", { hasText: "일반직원" }).locator("input").check();
await p.waitForTimeout(400);
const saved = await p.evaluate(() => localStorage.getItem("kei-approval-roles"));
ok((saved || "").includes("일반직원"), "9) 직급 체크가 localStorage에 기억됨");
body = await p.locator("main").textContent();
ok(/실･팀장|실·팀장/.test(body), "10) 국내출장·일반직원 → 실·팀장 전결(별표 정합)");
await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(1500);
const checkedAfter = await p.locator("aside label", { hasText: "일반직원" }).locator("input").isChecked();
ok(checkedAfter, "11) 새로고침 후에도 직급 체크 유지");
await p.screenshot({ path: "verify-approval-page.png" });

// ⑥ 위임전결규정 드로어 — 링크 카드
await p.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
await p.locator('input[aria-label="검색"]').first().fill("위임전결규정");
await p.waitForTimeout(900);
await p.getByText("위임전결규정", { exact: true }).first().click();
await p.waitForTimeout(1200);
body = await p.locator('[aria-label="문서 보기"]').textContent();
ok(body.includes("결재선 판정기 열기"), "12) 위임전결규정 드로어에 판정기 링크 카드");

await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 결재선 판정기 v3 검증 통과");
process.exit(fails.length ? 1 : 0);
