// 검증: ① 모바일 그래프 간소 뷰(캔버스 미로드·리스트·이웃 펼침) ② 오토픽스 diff /admin 열람. dev 3101.
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "admintest", password: "admtest123" } });

// ── ① 모바일 그래프 간소 뷰 ──
const p = await ctx.newPage();
await p.setViewportSize({ width: 390, height: 844 });
const canvasReqs = [];
p.on("request", (r) => { if (/force-graph/.test(r.url())) canvasReqs.push(r.url()); });
await p.goto(`${BASE}/graph/`, { waitUntil: "load" });
await p.waitForTimeout(2800);
ok(await p.locator('input[aria-label="문서 검색"]').isVisible(), "1) 모바일: 그래프 리스트 검색창");
ok(await p.locator("canvas").count() === 0, "2) 캔버스(react-force-graph) 미렌더");
ok(canvasReqs.length === 0, `3) force-graph 번들 미로드 (요청 ${canvasReqs.length}건)`);
ok(await p.locator('ul li button[aria-expanded]').count() > 0, "4) 문서 행 렌더");
await p.locator('ul li button[aria-expanded]:not([disabled])').first().click();
await p.waitForTimeout(400);
ok(await p.locator('a:has-text("이 문서 열기")').count() > 0, "5) 행 펼침 → 이웃 목록 + '이 문서 열기'");
ok((await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, "6) 가로 오버플로 없음");

// 데스크톱은 캔버스 유지(회귀)
const pd = await ctx.newPage();
await pd.setViewportSize({ width: 1440, height: 1000 });
await pd.goto(`${BASE}/graph/`, { waitUntil: "load" });
await pd.waitForTimeout(3000);
ok(await pd.locator("canvas").count() > 0, "7) 데스크톱: 캔버스 그래프 유지");
// 회귀(2026-07-20): 위키링크 URL 인코딩 도입 때 getGraph가 인코딩 슬러그를 stems와 대조해
// 엣지가 전부 버려짐 → '374개 문서 · 0개 연결'. 링크 수가 유의미한지 상시 단정.
const ginfo = await pd.evaluate(() => {
  const g = window.__NEXT_DATA__?.props?.pageProps?.graph;
  return g ? { n: g.nodes.length, l: g.links.length } : null;
});
ok(!!ginfo && ginfo.l > 100, `7b) 그래프 엣지 유의미(${ginfo?.n}노드·${ginfo?.l}링크 > 100)`);

// ── ② 오토픽스 diff /admin 열람 ──
const pa = await ctx.newPage();
await pa.setViewportSize({ width: 1440, height: 1200 });
await pa.goto(`${BASE}/admin/#reports`, { waitUntil: "load" });
await pa.waitForTimeout(2800);
const body = await pa.textContent("body");
ok(body.includes("관문 실패 diff"), "8) diff 섹션 노출");
const diffToggle = pa.locator('button:has-text("gate_forbidden"), button:has-text("gate_web")').first();
ok(await diffToggle.count() > 0, "9) 실패 항목(gate) 행 존재");
await diffToggle.click();
await pa.waitForTimeout(900);
ok(await pa.locator("pre").filter({ hasText: "diff --git" }).count() > 0, "10) 펼침 → diff 원문 표시");

await b.close();
console.log(fails.length ? `\n❌ ${fails.length}건 실패` : "\n✅ 전부 통과");
process.exit(fails.length ? 1 : 0);
