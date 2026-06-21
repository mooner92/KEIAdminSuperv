// 둘러보기/그래프 fill 레이아웃 + 페이지네이션 실렌더 검증.
import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
await p.setViewportSize({ width: 1440, height: 900 });
const fails = [];

// ── BROWSE ──
await p.goto("http://localhost:3100/browse/", { waitUntil: "load" });
await p.waitForTimeout(1500);
const biggestUl = () =>
  p.evaluate(() => {
    const uls = [...document.querySelectorAll("ul")].sort(
      (a, c) => c.querySelectorAll("li").length - a.querySelectorAll("li").length
    );
    return uls[0];
  });
const browse = await p.evaluate(() => {
  const pageScroll = document.documentElement.scrollHeight - window.innerHeight;
  const list = [...document.querySelectorAll("ul")].sort(
    (a, c) => c.querySelectorAll("li").length - a.querySelectorAll("li").length
  )[0];
  const rows = list ? list.querySelectorAll("li").length : 0;
  const listScrolls = list
    ? list.scrollHeight > list.clientHeight + 4 && getComputedStyle(list).overflowY !== "visible"
    : false;
  return { pageScroll, rows, listScrolls };
});
console.log(`BROWSE 페이지스크롤=${browse.pageScroll}px(≈0 기대) · 행=${browse.rows}(30 기대) · 목록내부스크롤=${browse.listScrolls}`);
if (browse.pageScroll > 4) fails.push("browse 페이지가 스크롤됨");
if (browse.rows !== 30) fails.push(`browse 기본 행수 ${browse.rows}≠30`);
if (!browse.listScrolls) fails.push("browse 목록 내부 스크롤 아님");

// pageSize 50
await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "50")?.click());
await p.waitForTimeout(400);
const rows50 = await p.evaluate(() =>
  [...document.querySelectorAll("ul")].sort((a, c) => c.querySelectorAll("li").length - a.querySelectorAll("li").length)[0].querySelectorAll("li").length
);
console.log(`pageSize 50 → 행=${rows50}(50 기대)`);
if (rows50 !== 50) fails.push(`pageSize 50 → ${rows50}≠50`);

// pageSize 10
await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "10")?.click());
await p.waitForTimeout(400);
const rows10 = await p.evaluate(() =>
  [...document.querySelectorAll("ul")].sort((a, c) => c.querySelectorAll("li").length - a.querySelectorAll("li").length)[0].querySelectorAll("li").length
);
console.log(`pageSize 10 → 행=${rows10}(10 기대)`);
if (rows10 !== 10) fails.push(`pageSize 10 → ${rows10}≠10`);

// 다음 페이지
const first1 = await p.evaluate(() => document.querySelector("ul li")?.textContent?.slice(0, 24));
await p.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "다음 페이지")?.click());
await p.waitForTimeout(400);
const first2 = await p.evaluate(() => document.querySelector("ul li")?.textContent?.slice(0, 24));
console.log(`다음 페이지 항목변경=${first1 !== first2}(true 기대)`);
if (first1 === first2) fails.push("다음 페이지 미동작");
await p.screenshot({ path: "verify-browse.png" });

// ── GRAPH ──
await p.goto("http://localhost:3100/graph/", { waitUntil: "load" });
await p.waitForTimeout(3000);
const graph = await p.evaluate(() => {
  const pageScroll = document.documentElement.scrollHeight - window.innerHeight;
  const c = document.querySelector("canvas");
  return { pageScroll, canvasH: c ? c.height : 0, hasCanvas: !!c };
});
console.log(`GRAPH 페이지스크롤=${graph.pageScroll}px(≈0 기대) · 캔버스높이=${graph.canvasH}px · 캔버스=${graph.hasCanvas}`);
if (graph.pageScroll > 4) fails.push("graph 페이지가 스크롤됨");
if (!graph.hasCanvas || graph.canvasH < 400) fails.push("graph 캔버스 미충전");
await p.screenshot({ path: "verify-graph-fit.png" });

await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 레이아웃·페이지네이션 검증 통과");
process.exit(fails.length ? 1 : 0);
