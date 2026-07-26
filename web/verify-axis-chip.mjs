// 축 문항 표시 검증(specs/07 B) — 데이터에 축이 있을 때만 실렌더 확인.
// ⚠ 축 문항은 다음 크론(내일 06:00)부터 실제로 쌓이므로, 데이터가 없으면 '스킵'으로 통과시킨다.
import { chromium } from "playwright";
import fs from "fs";

const BASE = "http://localhost:3101";
const day = "2026-07-26";
const raw = JSON.parse(fs.readFileSync(`public/quality/daily/${day}.json`, "utf8"));
const hasAxis = (raw.문항 || []).some((i) => i.축);
console.log(`데이터: 축 문항 ${(raw.문항 || []).filter((i) => i.축).length}건 · 다양성 ${raw.다양성 ? "있음" : "없음"}`);

if (!raw.다양성) { console.error("❌ 다양성 지표 미기록(daily_publish)"); process.exit(1); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: "test1234" } });
await ctx.route("**/app/flags**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ quality_board: true }) }));
const p = await ctx.newPage();

// 축이 없는 날에도 페이지가 깨지지 않아야 한다(약점지도 축 섹션은 빈 객체)
await p.goto(`${BASE}/quality/?date=${day}`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
const acc = await p.locator(`[class*="Quality_score"]`).first().textContent().catch(() => null);
console.log(`  /quality?date=${day} 렌더 · 정답률 ${acc ?? "(미표시)"}`);
if (!acc) { console.error("❌ 게시판 렌더 실패"); await b.close(); process.exit(1); }

const chips = await p.locator('[class*="Quality_axis"]').count();
if (hasAxis && chips === 0) { console.error("❌ 축 문항이 있는데 칩 미표시"); await b.close(); process.exit(1); }
console.log(`  실데이터 축 칩 ${chips}개`);

// ── 축 칩 경로 실렌더(데이터가 아직 0건이어도 지금 증명한다) ──
// 크론이 축 문항을 쌓기 전까진 실데이터로 확인할 수 없으므로 공개 JSON에 축을 주입해 렌더한다.
const AXES = ["amount", "impact", "defterm", "deadline"];
const injected = JSON.parse(JSON.stringify(raw));
injected.문항.slice(0, 4).forEach((it, i) => { it.축 = AXES[i]; });
injected.약점지도.축 = { amount: { 정답: 2, 표본: 2, 정답률: 100 }, impact: { 정답: 1, 표본: 2, 정답률: 50 } };
await p.route(`**/quality/daily/${day}.json`, (r) =>
  r.fulfill({ contentType: "application/json", body: JSON.stringify(injected) }));
await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(1000);
const chips2 = await p.locator('[class*="Quality_axis"]').allTextContents();
const bars = await p.locator('[class*="Quality_miniBar"]').allTextContents();
const axisBar = bars.find((t) => t.includes("금액전결"));
console.log(`  주입 렌더 — 문항 칩 ${chips2.length}개 ${JSON.stringify(chips2.slice(0, 2))} · 약점지도 축 "${axisBar ?? "없음"}"`);
if (chips2.length < 4 || !axisBar) { console.error("❌ 축 칩/축 정답률 미렌더"); await b.close(); process.exit(1); }
// 드로어(그날 상세)에도 축 칩이 붙는가 — 오답 문항에 축 주입
const bad = injected.문항.find((i) => i.판정 === "오답");
if (bad) {
  bad.축 = "deadline";
  await p.goto(`${BASE}/quality/trend/`, { waitUntil: "networkidle" });
  await p.route(`**/quality/daily/${day}.json`, (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify(injected) }));
  await p.locator(`[class*="dateBtn"]:has-text("${day}")`).first().click();
  await p.waitForTimeout(1200);
  const dchips = await p.locator('[class*="DayDetailDrawer_tag"]').allTextContents();
  const ok = dchips.some((t) => t.includes("기한"));
  console.log(`  드로어 태그 ${dchips.length}개 · 축 칩 ${ok ? "✅" : "❌"}`);
  if (!ok) { console.error("❌ 드로어 축 칩 미표시"); await b.close(); process.exit(1); }
}
await b.close();
console.log("🎉 축 표시 검증 통과");
