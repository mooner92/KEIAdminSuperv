// v1 ⑭(S7 잔여) 검증 — 그래프 노드 검색(#32)·결재선→별표 원문(#33) (dev 3101, explore_upgrades on).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });

// ── #32 그래프 노드 검색 ──
await p.goto(`${BASE}/graph/`, { waitUntil: "load" });
await p.waitForTimeout(5000); // force 시뮬 안정
const gs = p.locator('input[aria-label="노드 검색"]');
ok((await gs.count()) > 0, "1) 그래프 검색창 렌더");
await gs.fill("복무규정");
await gs.press("Enter");
await p.waitForTimeout(1500);
let body = await p.textContent("body");
ok(body.includes("복무규정") && /제\d+조|규정번호/.test(body), "2) 검색 → 노드 선택 + 분할 문서 패널 오픈");
ok((await p.locator('button:has-text("전체보기")').count()) > 0, "3) ⛶ 전체보기 버튼");
await p.locator('button:has-text("전체보기")').click();
await p.waitForTimeout(800);
// 미일치 피드백
await gs.fill("존재하지않는규정xyz");
await gs.press("Enter");
await p.waitForTimeout(500);
ok((await p.getByText("일치하는 노드 없음").count()) > 0, "4) 미일치 안내");
await p.screenshot({ path: "verify-s7b-graph.png" });

// ── #33 결재선 → 별표 원문 드로어 ──
await p.goto(`${BASE}/approval/`, { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
await p.locator('[aria-label="자주 찾는 업무"] button').filter({ hasText: "휴가" }).first().click();
await p.waitForTimeout(600);
const orig = p.locator('button:has-text("📜 원문")');
ok((await orig.count()) > 0, `5) 행별 '📜 원문' 버튼 (${await orig.count()}개)`);
await orig.first().click();
await p.waitForTimeout(1600);
const d = await p.locator('[aria-label="문서 보기"]').textContent();
ok((d || "").includes("위임전결규정"), "6) 원문 클릭 → 위임전결규정 드로어 오픈");
ok(/연차휴가|휴가/.test(d || ""), "7) 별표 관련 내용 렌더(하이라이트 대상 존재)");
await p.screenshot({ path: "verify-s7b-orig.png" });
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ ⑭(S7 잔여) 검증 통과");
process.exit(fails.length ? 1 : 0);
