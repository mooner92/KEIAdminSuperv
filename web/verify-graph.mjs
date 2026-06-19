import { chromium } from "playwright";

// 핵심: OS는 라이트(colorScheme:'light')인데 앱만 다크로 토글한 상황 = 사용자가 본 케이스 재현
const url = "http://localhost:3100/graph/";
const osScheme = process.env.OS_SCHEME || "light"; // 'light' | 'dark'
const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: osScheme });
await ctx.addInitScript(() => localStorage.setItem("kei-theme", "dark")); // 앱은 다크로

const page = await ctx.newPage();
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(3000);

const info = await page.evaluate(() => {
  const cs = (el) => (el ? getComputedStyle(el).backgroundColor : "none");
  const canvas = document.querySelector("canvas");
  let px = "NO_CANVAS";
  if (canvas) {
    const d = canvas.getContext("2d").getImageData(5, 5, 1, 1).data;
    px = `rgba(${d[0]},${d[1]},${d[2]},${d[3]})`;
  }
  // body/html 배경을 칠하는 CSS 규칙 추적(누가 흰색을 넣는가)
  const bgRules = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const r of sheet.cssRules) {
        if (r.selectorText && /(^|[\s,])(body|html|:root)([\s,{]|$)/.test(r.selectorText) && /background/.test(r.cssText)) {
          bgRules.push(r.cssText.slice(0, 160));
        }
      }
    } catch (e) {}
  }
  // 좌상단 여백 지점에서 실제로 보이는 요소 + 그 배경
  const elAt = document.elementFromPoint(20, 200);
  return {
    dataTheme: document.documentElement.getAttribute("data-theme"),
    htmlBg: cs(document.documentElement),
    bodyBg: cs(document.body),
    nextBg: cs(document.getElementById("__next")),
    canvasDivBg: cs(document.querySelector("[class*='canvas']")),
    canvasCssBg: cs(canvas),
    canvasPixel: px,
    elAt: elAt ? `${elAt.tagName}.${elAt.className}` : "none",
    elAtBg: cs(elAt),
    bgRules,
  };
});
console.log("OS scheme       =", osScheme);
console.log(JSON.stringify(info, null, 2));

await page.screenshot({ path: `verify-graph-${osScheme}.png`, fullPage: true });
console.log(`saved verify-graph-${osScheme}.png`);
await browser.close();
