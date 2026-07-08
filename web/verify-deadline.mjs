// Track B 기한 역산 계산기 실렌더 검증 — 드로어 '이 규정의 기한' 패널 + 날짜계산 (dev 3101).
// 전제: deadline_calc 플래그 on + 재빌드된 out/(deadlines 슬라이스).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1300 } });

const flags = await (await p.request.get(`${BASE}/api/app/flags`)).json();
ok(flags.deadline_calc === true, "1) deadline_calc 플래그 on");

await p.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
await p.locator('input[aria-label="검색"]').first().fill("인사규정");
await p.waitForTimeout(1000);
await p.getByText("인사규정", { exact: true }).first().click();
await p.waitForTimeout(1200);

const drawer = p.locator('[aria-label="문서 보기"]');
let body = await drawer.textContent();
ok(body.includes("이 규정의 기한"), "2) '이 규정의 기한' 패널 렌더");
ok(body.includes("원문") || body.includes("📄"), "3) 근거 원문 문장 병기");

// 첫 기준일 입력 → 마감일이 계산돼 표시되는지 (순수 산술)
const dateInput = drawer.locator('input[type="date"]').first();
ok((await dateInput.count()) > 0, "4) 기준일(date) 입력칸 존재");
await dateInput.fill("2026-03-15");
await p.waitForTimeout(500);
body = await drawer.textContent();
const hasDeadline = /마감\s*\d{4}\.\s*\d/.test(body);
ok(hasDeadline, "5) 기준일 입력 시 마감일 자동 계산 표시");
ok(body.includes("캘린더") || body.includes(".ics"), "6) .ics 내보내기 버튼 노출");

await drawer.getByText("이 규정의 기한").scrollIntoViewIfNeeded().catch(() => {});
await p.waitForTimeout(300);
await drawer.screenshot({ path: "verify-deadline.png" });

await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 기한 역산 계산기 검증 통과");
process.exit(fails.length ? 1 : 0);
