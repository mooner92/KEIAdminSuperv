import { chromium } from "playwright";

// 다크(OS=light+앱 다크)에서 ERP가 별도 섹션(시스템, 보라)으로 분리됐는지 실렌더 검증
const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: "light" });
await ctx.addInitScript(() => localStorage.setItem("kei-theme", "dark"));
const page = await ctx.newPage();

await page.goto("http://localhost:3100/browse/", { waitUntil: "load" });
await page.waitForTimeout(1200);

// 구분 필터에 'ERP 시스템' 탭 + 카운트
const sysFacet = await page.evaluate(() => {
  let found = null;
  document.querySelectorAll("label").forEach((l) => {
    const spans = l.querySelectorAll("span");
    if (spans.length >= 2 && spans[0].textContent.trim() === "ERP 시스템")
      found = spans[spans.length - 1].textContent.trim();
  });
  return found;
});
console.log("구분 'ERP 시스템' facet =", sysFacet, "(12 기대)");

// ERP 시스템 구분 체크 → 첫 행 → 드로어 칩 색
await page.evaluate(() => {
  const lbl = Array.from(document.querySelectorAll("label")).find(
    (l) => l.querySelector("span")?.textContent.trim() === "ERP 시스템"
  );
  if (lbl) lbl.querySelector("input").click();
});
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector("ul button")?.click());
await page.waitForTimeout(1400);
const chip = await page.evaluate(() => {
  const c = document.querySelector('[role="dialog"] [data-section="시스템"]');
  return c ? { text: c.textContent.trim(), bg: getComputedStyle(c).backgroundColor } : "NO_CHIP";
});
console.log("드로어 섹션 칩 =", JSON.stringify(chip), "(보라 #a78bfa=rgb(167,139,250) 기대)");
await page.screenshot({ path: "verify-system-browse.png" });

// 그래프: 범례에 'ERP 시스템' + 보라 노드 픽셀
await page.goto("http://localhost:3100/graph/", { waitUntil: "load" });
await page.waitForTimeout(3000);
const legendHasSys = await page.evaluate(() => document.body.innerText.includes("ERP 시스템"));
const purple = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  if (!c) return "NO_CANVAS";
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
    // #8b5cf6 ≈ rgb(139,92,246): b 높고 g 낮음
    if (a > 200 && b > 190 && r > 90 && r < 180 && g < 130 && b - g > 80) n++;
  }
  return n;
});
console.log("그래프 범례 'ERP 시스템' 표시?", legendHasSys);
console.log("보라(시스템) 노드 픽셀 =", purple, "(0이면 안보임)");
await page.screenshot({ path: "verify-system-graph.png", fullPage: true });

await browser.close();
console.log("saved verify-system-browse.png / verify-system-graph.png");
