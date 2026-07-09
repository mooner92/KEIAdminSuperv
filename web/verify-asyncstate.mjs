// v1 ⑪(S8-#17) 공용 AsyncState 검증 — 네트워크 차단으로 에러 유발 → 재시도 성공 (dev 3101).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });

// ── 1) 결재선 페이지: approval.json 차단 → 에러+재시도 → 해제 후 복구 ──
await p.route("**/approval.json", (r) => r.abort());
await p.goto(`${BASE}/approval/`, { waitUntil: "load" });
await p.waitForTimeout(1500);
let body = await p.textContent("body");
ok(body.includes("불러오지 못했습니다") && body.includes("다시 시도"), "1) /approval 에러 + 재시도 버튼");
await p.unroute("**/approval.json");
await p.getByText("다시 시도").first().click();
await p.waitForTimeout(1500);
body = await p.textContent("body");
ok(/전결/.test(body) && /\d+건/.test(body), "2) 재시도 → 전결규칙 로드 성공");

// ── 2) 문서 드로어: docdata 차단 → 에러+재시도 → 복구 ──
await p.route("**/docdata/**", (r) => r.abort());
await p.goto(`${BASE}/browse/`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
await p.locator('input[aria-label="검색"]').first().fill("복무규정");
await p.waitForTimeout(800);
await p.getByText("복무규정", { exact: true }).first().click();
await p.waitForTimeout(1200);
const drawer = p.locator('[aria-label="문서 보기"]');
let d = await drawer.textContent();
ok(d.includes("불러오지 못했습니다") && d.includes("다시 시도"), "3) 드로어 에러 + 재시도 버튼");
await p.unroute("**/docdata/**");
await drawer.getByText("다시 시도").first().click();
await p.waitForTimeout(1400);
d = await drawer.textContent();
ok(d.includes("복무규정") && /제\d+조/.test(d), "4) 드로어 재시도 → 본문 로드 성공");
await p.screenshot({ path: "verify-asyncstate.png" });

// ── 3) 로딩 점 애니메이션 존재(정상 흐름의 일관 로딩 UI) ──
await p.route("**/approval.json", async (r) => { await new Promise(res => setTimeout(res, 1200)); r.continue(); });
await p.goto(`${BASE}/approval/`, { waitUntil: "load" });
await p.waitForTimeout(500);
ok((await p.locator('[class*="dots"]').count()) > 0, "5) 공용 로딩 인디케이터(점 애니메이션) 렌더");
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ AsyncState 검증 통과");
process.exit(fails.length ? 1 : 0);
