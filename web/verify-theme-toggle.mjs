// 테마 토글 검증 — 기본=시스템(OS 따름), 클릭은 라이트↔다크만(시스템 미노출). dev 3101.
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();

// ① 기본=시스템: 저장값 없이 OS가 dark면 data-theme=dark
const darkCtx = await b.newContext({ colorScheme: "dark" });
const pd = await darkCtx.newPage();
await pd.goto(`${BASE}/help/`, { waitUntil: "load" });
await pd.waitForTimeout(600);
ok(await pd.evaluate(() => document.documentElement.dataset.theme) === "dark", "1) 기본(저장값 없음)+OS다크 → data-theme=dark(시스템 따름)");
ok(await pd.evaluate(() => localStorage.getItem("kei-theme")) !== "light" && await pd.evaluate(() => localStorage.getItem("kei-theme")) !== "dark",
  "2) 최초엔 명시 저장 없음(system 유지)");

// ② 라이트 OS에서 토글 클릭 → 다크로(명시), 재클릭 → 라이트. 시스템은 클릭으로 안 나옴.
const lightCtx = await b.newContext({ colorScheme: "light" });
const p = await lightCtx.newPage();
await p.goto(`${BASE}/help/`, { waitUntil: "load" });
await p.waitForTimeout(600);
ok(await p.evaluate(() => document.documentElement.dataset.theme) === "light", "3) OS 라이트 → data-theme=light");
const btn = p.locator('button[aria-label^="테마 전환"]');
const seq = [];
for (let i = 0; i < 4; i++) {
  await btn.click(); await p.waitForTimeout(250);
  seq.push(await p.evaluate(() => document.documentElement.dataset.theme));
}
ok(JSON.stringify(seq) === JSON.stringify(["dark", "light", "dark", "light"]),
  `4) 클릭 순환이 라이트↔다크만 (${seq.join("→")})`);
const stored = await p.evaluate(() => localStorage.getItem("kei-theme"));
ok(stored === "light" || stored === "dark", `5) 클릭 후 명시값 저장(${stored}) — 'system' 아님`);
const label = await btn.locator("span").last().innerText();
ok(label === "라이트" || label === "다크", `6) 라벨=현재 테마(${label}) — '시스템' 미표시`);

await b.close();
console.log(fails.length ? `\n❌ ${fails.length}건 실패` : "\n✅ 전부 통과");
process.exit(fails.length ? 1 : 0);
