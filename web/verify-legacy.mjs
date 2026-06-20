// 레거시 v1.0.0(3101) 실제 렌더 검증 — 표준 규칙(번들 검사 금지, 실제 픽셀/DOM로 판정).
// 현행(3100)과 동일 UI가 격리 포트에서 정상 렌더되는지 + 다크모드 토큰까지 확인.
import { chromium } from "playwright";

const browser = await chromium.launch();
const fails = [];

async function check(label, theme) {
  const ctx = await browser.newContext({ colorScheme: "light" });
  await ctx.addInitScript((t) => localStorage.setItem("kei-theme", t), theme);
  const page = await ctx.newPage();
  await page.goto("http://localhost:3101/", { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    const text = document.body.innerText.trim();
    // 다크/라이트 판정: body 배경의 밝기
    const m = bg.match(/\d+/g) || [255, 255, 255];
    const lum = (+m[0] + +m[1] + +m[2]) / 3;
    return { bg, lum, hasText: text.length > 0, sample: text.slice(0, 60) };
  });
  const wantDark = theme === "dark";
  const isDark = info.lum < 90;
  const ok = info.hasText && wantDark === isDark;
  console.log(`[${label}] bg=${info.bg} lum=${info.lum.toFixed(0)} hasText=${info.hasText} → ${ok ? "OK" : "FAIL"}`);
  console.log(`         sample="${info.sample}"`);
  if (!ok) fails.push(label);
  await page.screenshot({ path: `verify-legacy-${theme}.png` });
  await ctx.close();
}

await check("3101 라이트", "light");
await check("3101 다크", "dark");

// 그래프 페이지도 한 번 (노드 렌더 확인)
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto("http://localhost:3101/graph/", { waitUntil: "load" });
await page.waitForTimeout(3000);
const nodes = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  if (!c) return -1;
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let painted = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) painted++;
  return painted;
});
console.log(`[3101 그래프] canvas painted px=${nodes} → ${nodes > 1000 ? "OK" : "FAIL"}`);
if (nodes <= 1000) fails.push("3101 그래프");
await page.screenshot({ path: "verify-legacy-graph.png", fullPage: true });

await browser.close();
console.log(fails.length ? `\n❌ FAIL: ${fails.join(", ")}` : "\n✅ 3101 레거시 렌더 검증 통과");
process.exit(fails.length ? 1 : 0);
