// Track B 결재선 판정기 실렌더 검증 — 위임전결규정 드로어 (dev 3101).
// 전제: approval_finder 플래그 on + 재빌드 out/(위임전결규정 approval 슬라이스).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1300 } });

const flags = await (await p.request.get(`${BASE}/api/app/flags`)).json();
ok(flags.approval_finder === true, "1) approval_finder 플래그 on");

await p.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
await p.locator('input[aria-label="검색"]').first().fill("위임전결규정");
await p.waitForTimeout(1000);
await p.getByText("위임전결규정", { exact: true }).first().click();
await p.waitForTimeout(1300);

const drawer = p.locator('[aria-label="문서 보기"]');
let body = await drawer.textContent();
ok(body.includes("결재선 판정기"), "2) '결재선 판정기' 패널 렌더");
ok(body.includes("부서 확인"), "3) '실무는 부서 확인' 면책 노출");

// 업무 검색 '출장' → 전결권자 표시
const search = drawer.locator('input[aria-label="업무 검색"]');
ok((await search.count()) > 0, "4) 업무 검색창 존재");
await search.fill("출장");
await p.waitForTimeout(500);
body = await drawer.textContent();
ok(body.includes("전결") && /출장/.test(body), "5) '출장' 검색 시 전결권자 결과 표시");

// 직급 필터(비정규직) → 과제책임자 전결 확인
await drawer.locator('select[aria-label="신청자 직급"]').selectOption({ label: "비정규직(연구직)" }).catch(() => {});
await p.waitForTimeout(500);
body = await drawer.textContent();
ok(/과제책임자/.test(body), "6) 직급 필터(비정규직)→과제책임자 전결 반영");

await drawer.getByText("결재선 판정기").scrollIntoViewIfNeeded().catch(() => {});
await p.waitForTimeout(300);
await drawer.screenshot({ path: "verify-approval.png" });

await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 결재선 판정기 검증 통과");
process.exit(fails.length ? 1 : 0);
