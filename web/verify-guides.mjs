import { chromium } from "playwright";

// 다크(OS=light + 앱 다크)에서 가이드가 그래프/둘러보기/드로어에 제대로 들어갔는지 실렌더 검증
const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: "light" });
await ctx.addInitScript(() => localStorage.setItem("kei-theme", "dark"));
const page = await ctx.newPage();

// 1) 둘러보기: 구분 facet 카운트(연구행정 가이드 N) + 첫 가이드 드로어 열기
await page.goto("http://localhost:3100/browse/", { waitUntil: "load" });
await page.waitForTimeout(1200);
const counts = await page.evaluate(() => {
  const out = {};
  document.querySelectorAll("label").forEach((l) => {
    const spans = l.querySelectorAll("span");
    if (spans.length >= 2) {
      const name = spans[0].textContent.trim();
      const cnt = spans[spans.length - 1].textContent.trim();
      if (["규정집", "연구행정 가이드", "용어집"].includes(name)) out[name] = cnt;
    }
  });
  return out;
});
console.log("구분 facet 카운트 =", JSON.stringify(counts));
await page.screenshot({ path: "verify-guide-browse.png" });

// 가이드 한 건 클릭 → Notion 드로어 열림 확인 (가이드 칩이 있는 행)
const opened = await page.evaluate(() => {
  const chip = Array.from(document.querySelectorAll("span")).find(
    (s) => s.textContent.trim() === "연구행정 가이드" && s.closest("button")
  );
  if (!chip) return null;
  chip.closest("button").click();
  return true;
});
await page.waitForTimeout(1500);
const drawer = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  return d ? d.innerText.slice(0, 120).replace(/\n/g, " ") : "NO_DRAWER";
});
console.log("가이드 클릭 →", opened ? "행 클릭됨" : "가이드 행 못찾음");
console.log("드로어 내용 머리 =", drawer);
await page.screenshot({ path: "verify-guide-drawer.png" });

// 2) 그래프: 문서/연결 수 + 초록(가이드) 노드 존재 여부
await page.goto("http://localhost:3100/graph/", { waitUntil: "load" });
await page.waitForTimeout(3000);
const lead = await page.evaluate(() => {
  const el = document.querySelector("p");
  return el ? el.textContent.trim() : "?";
});
const greenPixels = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  if (!c) return "NO_CANVAS";
  const ctx = c.getContext("2d");
  const { width, height } = c;
  const img = ctx.getImageData(0, 0, width, height).data;
  let green = 0;
  for (let i = 0; i < img.length; i += 4) {
    const r = img[i], g = img[i + 1], b = img[i + 2], a = img[i + 3];
    // 가이드 노드색 ≈ #2dd08f(45,208,143): g가 크고 r/b가 작은 픽셀
    if (a > 200 && g > 150 && r < 120 && b < 170 && g - r > 60) green++;
  }
  return green;
});
console.log("그래프 lead =", lead);
console.log("초록(가이드) 노드 픽셀 수 =", greenPixels, "(0이면 가이드 노드 없음/안보임)");
await page.screenshot({ path: "verify-guide-graph.png", fullPage: true });

await browser.close();
console.log("saved verify-guide-browse.png / verify-guide-drawer.png / verify-guide-graph.png");
