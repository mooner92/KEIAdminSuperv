import { chromium } from "playwright";

// 다크(OS=light+앱 다크)에서 ERP 노트가 둘러보기(분류 ERP시스템)·드로어·그래프에 들어갔는지 실렌더 검증
const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: "light" });
await ctx.addInitScript(() => localStorage.setItem("kei-theme", "dark"));
const page = await ctx.newPage();

await page.goto("http://localhost:3100/browse/", { waitUntil: "load" });
await page.waitForTimeout(1200);

// 분류 필터에 ERP시스템 N 있는지
const erpCat = await page.evaluate(() => {
  let found = null;
  document.querySelectorAll("label").forEach((l) => {
    const spans = l.querySelectorAll("span");
    if (spans.length >= 2 && spans[0].textContent.trim() === "ERP시스템")
      found = spans[spans.length - 1].textContent.trim();
  });
  return found;
});
console.log("분류 'ERP시스템' facet =", erpCat, "(12 기대)");

// ERP시스템 분류 체크 → 첫 행 클릭 → 드로어
await page.evaluate(() => {
  const lbl = Array.from(document.querySelectorAll("label")).find(
    (l) => l.querySelector("span") && l.querySelector("span").textContent.trim() === "ERP시스템"
  );
  if (lbl) lbl.querySelector("input").click();
});
await page.waitForTimeout(600);
await page.evaluate(() => {
  const row = document.querySelector("ul button");
  if (row) row.click();
});
await page.waitForTimeout(1500);
const drawer = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  return d ? d.innerText.slice(0, 160).replace(/\n/g, " ") : "NO_DRAWER";
});
console.log("ERP 드로어 머리 =", drawer);
await page.screenshot({ path: "verify-erp-browse.png" });

// 그래프 문서 수
await page.goto("http://localhost:3100/graph/", { waitUntil: "load" });
await page.waitForTimeout(2500);
const lead = await page.evaluate(() => document.querySelector("p")?.textContent.trim());
console.log("그래프 lead =", lead);
await page.screenshot({ path: "verify-erp-graph.png", fullPage: true });

await browser.close();
console.log("saved verify-erp-browse.png / verify-erp-graph.png");
