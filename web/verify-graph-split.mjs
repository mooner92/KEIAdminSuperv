// graph_split 플래그 end-to-end: OFF=노드 클릭 시 /d/로 이동 / ON=옆 문서 패널(분할 뷰), 그래프 유지.
// 사용: node verify-graph-split.mjs off|on
import { chromium } from "playwright";

const BASE = "http://localhost:3100";
const USER = "fb_test";
const PW = "test1234";
const MODE = process.argv[2] === "on" ? "on" : "off";
const expectOn = MODE === "on";
const fails = [];
const ok = (c, m) => {
  console.log((c ? "✅ " : "❌ ") + m);
  if (!c) fails.push(m);
};

// canvas 노드 클릭: 중앙 + 오프셋 그리드로 노드를 맞힐 때까지(predicate 충족) 시도
async function clickNodeUntil(p, predicate) {
  const canvas = await p.waitForSelector("canvas", { timeout: 15000 }).catch(() => null);
  if (!canvas) return false;
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const offs = [[0, 0], [0, -40], [40, 0], [0, 40], [-40, 0], [55, -55], [-55, 55], [90, 0], [0, -90], [-90, -45], [120, 60]];
  for (const [dx, dy] of offs) {
    await p.mouse.click(cx + dx, cy + dy);
    await p.waitForTimeout(1300);
    if (await predicate()) return true;
  }
  return false;
}

const b = await chromium.launch();
const ctx = await b.newContext();
let r = await ctx.request.post(`${BASE}/api/app/auth/register`, { data: { username: USER, password: PW } });
if (r.status() === 409) r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: USER, password: PW } });
ok(r.ok(), `0) 로그인 (${r.status()})`);

const p = await ctx.newPage();
await p.goto(`${BASE}/graph/`, { waitUntil: "load" });
await p.waitForTimeout(5000); // 그래프 force 시뮬레이션 안정 대기

const flag = await p.evaluate(async () => {
  try {
    return (await (await fetch("/api/app/flags")).json()).graph_split;
  } catch {
    return null;
  }
});
ok(flag === expectOn, `1) graph_split=${flag} (기대 ${expectOn})`);

const splitCount = await p.locator('[class*="split"]').count();
ok(expectOn ? splitCount > 0 : splitCount === 0, `2) 분할 컨테이너=${splitCount} (기대 ${expectOn ? "있음" : "없음"})`);

if (expectOn) {
  const hit = await clickNodeUntil(p, async () => (await p.locator('[class*="docPanel"]').count()) > 0);
  ok(hit, "3) 노드 클릭 → 옆 문서 패널 열림");
  ok(p.url().includes("/graph"), `4) 페이지 이동 없음(URL ${new URL(p.url()).pathname})`);
  ok((await p.locator("canvas").count()) > 0, "5) 그래프 캔버스 유지(동시 표시)");
  // 다른 노드 클릭 → 패널 유지(닫지 않고 전환)
  const box = await (await p.$("canvas")).boundingBox();
  await p.mouse.click(box.x + box.width / 2 + 110, box.y + box.height / 2 + 70);
  await p.waitForTimeout(1400);
  ok((await p.locator('[class*="docPanel"]').count()) > 0 && p.url().includes("/graph"),
     "6) 다른 노드 클릭해도 패널 유지·이동 없음");
  await p.screenshot({ path: "verify-graph-split-on.png", fullPage: false });
} else {
  const navigated = await clickNodeUntil(p, async () => p.url().includes("/d/"));
  ok(navigated, `3) 노드 클릭 → 문서 페이지로 이동(URL ${new URL(p.url()).pathname})`);
}

await b.close();
console.log(fails.length ? `\n❌ [${MODE}] ` + fails.join(" / ") : `\n✅ [${MODE}] graph_split 검증 통과`);
process.exit(fails.length ? 1 : 0);
