// Track C(그래프 분석) 실렌더 검증 — 드로어 '개정 파급·함께 보는 조문' 패널 (dev 3101).
// 전제: graph_impact 플래그 on + 재빌드된 out/(trackC 슬라이스 포함).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1300 } });

const flags = await (await p.request.get(`${BASE}/api/app/flags`)).json();
ok(flags.graph_impact === true, "1) graph_impact 플래그 on");

// 복무규정(개정 파급 24·공동인용 6) 드로어 열기
await p.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
const box = p.locator('input[aria-label="검색"]').first();
await box.fill("복무규정");
await p.waitForTimeout(1000);
await p.getByText("복무규정", { exact: true }).first().click();
await p.waitForTimeout(1200);
let body = await p.textContent("body");

ok(body.includes("개정 파급"), "2) '개정 파급 — 준용·참조하는 규정' 섹션 렌더");
ok(body.includes("함께 보는 조문"), "3) '함께 보는 조문' 섹션 렌더");
ok(body.includes("보수규정") || body.includes("인사규정"), "4) 파급 대상 규정 칩 노출");
await p.screenshot({ path: "verify-trackC-drawer.png" });

// 파급 칩 클릭 → 대상 규정으로 드로어 이동(slug 해석 확인 — 404 아님)
const drawer = p.locator('[aria-label="문서 보기"]');
const before = (await drawer.locator("h1").first().textContent())?.trim();
const chip = drawer.locator("button", { hasText: /^보수규정$|^인사규정$/ }).first();
if (await chip.count()) {
  await chip.click();
  await p.waitForTimeout(1300);
  const after = (await drawer.locator("h1").first().textContent())?.trim();
  const errored = (await p.textContent("body")).includes("문서를 불러오지 못했습니다");
  ok(after !== before && !errored, `5) 파급 칩 클릭→대상 규정 로드 (${before}→${after}, 404=${errored})`);
} else {
  ok(false, "5) 파급 칩을 찾지 못함");
}
await p.screenshot({ path: "verify-trackC-nav.png" });

await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ Track C 드로어 패널 검증 통과");
process.exit(fails.length ? 1 : 0);
