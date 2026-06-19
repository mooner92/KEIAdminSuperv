import { chromium } from "playwright";

const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: "light" });
await ctx.addInitScript(() => localStorage.setItem("kei-theme", "dark"));
const page = await ctx.newPage();

await page.goto("http://localhost:3100/browse/", { waitUntil: "load" });
await page.waitForTimeout(1200);
const facet = await page.evaluate(() => {
  let v = null;
  document.querySelectorAll("label").forEach((l) => {
    const s = l.querySelectorAll("span");
    if (s.length >= 2 && s[0].textContent.trim() === "용어집") v = s[s.length - 1].textContent.trim();
  });
  return v;
});
console.log("구분 '용어집' facet =", facet, "(84 기대)");

await page.evaluate(() => {
  const lbl = Array.from(document.querySelectorAll("label")).find(
    (l) => l.querySelector("span")?.textContent.trim() === "용어집"
  );
  if (lbl) lbl.querySelector("input").click();
});
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector("ul button")?.click());
await page.waitForTimeout(1400);
const chip = await page.evaluate(() => {
  const c = document.querySelector('[role="dialog"] [data-section="용어집"]');
  return c ? { text: c.textContent.trim(), bg: getComputedStyle(c).backgroundColor } : "NO_CHIP";
});
const drawerHead = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"] h1');
  return d ? d.textContent.trim() : "?";
});
console.log("드로어 용어 =", drawerHead, "| 섹션 칩 =", JSON.stringify(chip), "(주황 기대)");
await page.screenshot({ path: "verify-terms-browse.png" });

await page.goto("http://localhost:3100/graph/", { waitUntil: "load" });
await page.waitForTimeout(3000);
const lead = await page.evaluate(() => document.querySelector("p")?.textContent.trim());
const orange = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
    // #fe9800 ≈ rgb(254,152,0): r 높고 b 낮음
    if (a > 200 && r > 200 && g > 110 && g < 190 && b < 80) n++;
  }
  return n;
});
console.log("그래프 lead =", lead);
console.log("주황(용어집) 노드 픽셀 =", orange);
await page.screenshot({ path: "verify-terms-graph.png", fullPage: true });
await browser.close();
console.log("saved verify-terms-browse.png / verify-terms-graph.png");
