// v1 스펙 ⑦(#46) 검증 — cite_highlight·graph_split 졸업(플래그 제거 → 상시 적용) (dev 3101).
// (구 verify-cite-highlight.mjs / verify-graph-split.mjs 대체 — 토글형 → 상시형)
import { chromium } from "playwright";

// ⛔ 테스트 계정 비밀번호를 코드에 두지 않는다(보안 스캔 후속 — dev 계정 14개가
//    레포에 박힌 비밀번호로 열리던 것을 2026-07-29에 회전).
//    실행: set -a; . tools/.test_credentials; set +a; node <이 파일>
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — tools/.test_credentials 를 로드하세요.");
  process.exit(2);
}
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage({ viewport: { width: 1440, height: 1100 } });

// 1) 레지스트리에서 제거됐는지(공개 플래그 목록에 없음)
const flags = await (await p.request.get(`${BASE}/api/app/flags`)).json();
ok(!("cite_highlight" in flags) && !("graph_split" in flags), "1) 두 플래그가 레지스트리에서 제거됨");

// 2) graph_split 상시: 노드 클릭 → 페이지 이동 없이 분할 패널
await p.goto(`${BASE}/graph/`, { waitUntil: "load" });
await p.waitForTimeout(5000);
const canvas = await p.waitForSelector("canvas", { timeout: 15000 }).catch(() => null);
ok(!!canvas, "2) 그래프 캔버스 렌더");
let split = false;
if (canvas) {
  const box = await canvas.boundingBox();
  const offs = [[0, 0], [0, -40], [40, 0], [0, 40], [-40, 0], [55, -55], [-55, 55], [90, 0], [0, -90]];
  for (const [dx, dy] of offs) {
    await p.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
    await p.waitForTimeout(1200);
    if (p.url().includes("/d/")) break; // 이동해버리면 실패
    if ((await p.locator('[class*="GraphDocPanel"], aside[class*="panel"], [class*="docPanel"]').count()) > 0) { split = true; break; }
    const bodyTxt = await p.textContent("body");
    if (/전체화면|문서 보기/.test(bodyTxt || "")) { split = true; break; }
  }
}
ok(split && !p.url().includes("/d/"), "3) 노드 클릭 → 분할 뷰(페이지 이동 없음) 상시 동작");

// 3) cite_highlight 상시: 기존 대화의 근거 패널에 ⭐핵심 근거 표시
let r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: TEST_PW } });
ok(r.ok(), `4) 로그인 (${r.status()})`);
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(1500);
const star = await p.locator("aside").getByText("핵심 근거").count();
ok(star > 0, "5) 근거 패널 ⭐핵심 근거 상시 표시");

await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 플래그 졸업 검증 통과");
process.exit(fails.length ? 1 : 0);
