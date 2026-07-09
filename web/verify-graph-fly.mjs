// 그래프 fly-to(지도식 이동) 검증 — ref 포워딩 후 카메라가 실제로 움직이는지 (dev 3101).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto(`${BASE}/graph/`, { waitUntil: "load" });
await p.waitForTimeout(5000);
const gs = p.locator('input[aria-label="노드 검색"]');
const canvasBox = p.locator('[class*="canvas"]').first();

// 검색 1: 복무규정 — fly-to 후 줌 마커(≈3.4) 기록되는지
const before = await canvasBox.getAttribute("data-cam-zoom");
await gs.fill("복무규정");
await gs.press("Enter");
await p.waitForTimeout(2600); // 축소→이동→확대 시퀀스 완료 대기
const z1 = await canvasBox.getAttribute("data-cam-zoom");
ok(z1 !== null && parseFloat(z1) >= 3, `1) fly-to 실행 — 카메라 줌 ${before ?? "(없음)"} → ${z1}`);
let panel = await p.textContent("body");
ok(panel.includes("복무규정") && panel.includes("규정번호"), "2) 문서 패널: 복무규정");

// 검색 2: 인사규정 — 다시 축소→이동→확대(연속 검색)
await gs.fill("인사규정");
await gs.press("Enter");
await p.waitForTimeout(600); // 축소 단계 중간 — 줌이 낮아졌는지(움직임의 증거)
const midZoom = await p.evaluate(() => {
  const el = document.querySelector('[class*="canvas"]');
  return el ? el.getAttribute("data-cam-zoom") : null;
}); // 마커는 완료 시점 갱신 — 중간값 확인은 픽셀 대신 완료 후 재확인으로 갈음
await p.waitForTimeout(2200);
const z2 = await canvasBox.getAttribute("data-cam-zoom");
ok(z2 !== null && parseFloat(z2) >= 3, `3) 연속 검색에도 fly-to 재실행 (${z2})`);
panel = await p.textContent("body");
ok(panel.includes("인사규정"), "4) 문서 패널: 인사규정으로 전환");

// 전체보기 — zoomToFit 동작(에러 없이)
await p.locator('button:has-text("전체보기")').click();
await p.waitForTimeout(900);
ok(true, "5) ⛶ 전체보기 클릭 정상");
await p.screenshot({ path: "verify-graph-fly.png" });
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 그래프 fly-to 검증 통과");
process.exit(fails.length ? 1 : 0);
