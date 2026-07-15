// docs/35 수용 기준 실렌더 검증 — 지금 KEI에서(/now)·시즌 캘린더·사용량 수집.
import { chromium } from "playwright";
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const b = await chromium.launch();
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log((ok ? "✅" : "❌") + " " + n + (d ? " — " + d : "")); ok ? pass++ : fail++; };

const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
await ctx.request.post(BASE + "/api/app/auth/login", { data: { username: "admintest", password: "admtest123" } });
const p = await ctx.newPage();
const trackCalls = [];
p.on("request", (r) => { if (r.url().includes("/api/app/track")) trackCalls.push(JSON.parse(r.postData() || "{}").name); });

// ① 페이지·GNB·5블록
await p.goto(BASE + "/now/", { waitUntil: "load" });
await p.waitForTimeout(2500);
const body = await p.innerText("body");
// docs/41: /now는 '추가 기능' 허브 — 바로가기(캘린더·서식·새로워진) + 요즘 흐름(키워드·개정·용어)
check("① GNB '추가 기능' 탭", (await p.innerText("header")).includes("추가 기능"));
check("① 허브 제목", body.includes("추가 기능"));
check("① 바로가기 구역", body.includes("바로가기"));
check("① 요즘 흐름 구역", body.includes("요즘 흐름"));
check("① 바로가기: 업무 캘린더", (await p.locator('a[href="/calendar/"]').count()) >= 1);
check("① 바로가기: 서식 찾기", (await p.locator('a[href="/forms/"]').count()) >= 1);
check("① 바로가기: 새로워진 점", (await p.locator('a[href="/changelog/"]').count()) >= 1);
check("① 키워드 블록(로그인)", body.includes("요즘 많이 찾는 키워드"));
check("① 최근 개정 규정 5건", (await p.locator('section[aria-label="최근 개정된 규정"] li').count()) === 5);
check("① 오늘의 용어", body.includes("오늘의 용어"));
await p.screenshot({ path: "verify-now.png" });

// ② 오늘의 용어 결정성 — 새로고침해도 같은 용어
const term1 = await p.locator('section[aria-label="오늘의 용어"] a').first().innerText();
await p.reload({ waitUntil: "load" });
await p.waitForTimeout(2000);
const term2 = await p.locator('section[aria-label="오늘의 용어"] a').first().innerText();
check("② 오늘의 용어 결정적(새로고침 동일)", term1 === term2, `${term1}`);

// ③ 사용량 track 발화(now_view + page_view)
check("③ track 발화", trackCalls.includes("now_view") && trackCalls.includes("page_view"), trackCalls.join(","));

// ④ 서식 바로가기 카드에 실측 서식 수(loadForms) 노출
check("④ 서식 바로가기 서식 수", /서식\s*\d{2,}종/.test(body), body.match(/서식\s*\d+종/)?.[0] || "미표시");

// ⑤ 다크 실측
const pd = await ctx.newPage();
await pd.addInitScript(() => localStorage.setItem("kei-theme", "dark"));
await pd.goto(BASE + "/now/", { waitUntil: "load" });
await pd.waitForTimeout(1800);
const dark = await pd.evaluate(() => {
  const el = document.querySelector("section h2");
  const m = getComputedStyle(el).color.match(/\d+/g).map(Number);
  return (m[0] + m[1] + m[2]) / 3;
});
check("⑤ 다크: 카드 제목 밝음", dark > 150, String(dark));
await pd.screenshot({ path: "verify-now-dark.png" });
await pd.close();

// ⑥ admin 사용량 블록 — 방금 발화한 이벤트가 집계에 반영 + k-익명 고지
await p.goto(BASE + "/admin/#dash", { waitUntil: "load" });
await p.waitForTimeout(2500);
const ab = await p.innerText("body");
check("⑥ admin 기능 사용량 블록", ab.includes("기능 사용량") && ab.includes("page_view"));
check("⑥ 집계만·미노출 고지", ab.includes("집계만") && ab.includes("미노출"));
check("⑥ k-익명 마스킹 표시('N명 미만')", /\d명 미만/.test(ab), "테스트 사용자 수 < K이면 마스킹돼야 함");
await p.screenshot({ path: "verify-usage-admin.png" });

// ⑦ flag off 게이트(새 컨텍스트+응답 고정): GNB 미노출 + /now 준비 중 + track 0건
//    ⚠ GET /app/flags 응답은 평면 dict({events_tab: true, ...}) — j.flags 아님(리뷰 확정 결함 수정)
const ctxOff = await b.newContext();
await ctxOff.route("**/api/app/flags**", async (route) => {
  try {
    const r = await route.fetch();
    const j = await r.json();
    j.events_tab = false;
    j.usage_analytics = false;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(j) });
  } catch { await route.abort().catch(() => {}); }
});
const poff = await ctxOff.newPage();
let offTracks = 0;
poff.on("request", (r) => { if (r.url().includes("/api/app/track")) offTracks++; });
await poff.goto(BASE + "/now/", { waitUntil: "load" });
const gated = await poff.waitForFunction(
  () => document.body.innerText.includes("준비 중") && !document.querySelector("header a[href='/now/']"),
  undefined, { timeout: 8000 }).then(() => true).catch(() => false);
check("⑦ flag off: GNB 미노출 + 준비 중", gated);
await poff.waitForTimeout(1500);
check("⑦ flag off: track 전송 0건", offTracks === 0, String(offTracks));
await ctxOff.close().catch(() => {});

// ⑧ 모바일(375px, 리뷰 확정: GNB 6탭 오버플로) — 페이지 가로 스크롤 없음 + nav 내부 스크롤 허용
const pm = await ctx.newPage();
await pm.setViewportSize({ width: 375, height: 800 });
for (const path of ["/", "/now/"]) {
  await pm.goto(BASE + path, { waitUntil: "load" });
  await pm.waitForTimeout(1200);
  const noHScroll = await pm.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check(`⑧ 375px ${path}: 가로 스크롤 없음`, noHScroll);
}
const navReach = await pm.evaluate(() => {
  const nav = document.querySelector("header nav");
  if (!nav) return false;
  nav.scrollLeft = 99999; // 스크롤러블 nav — 끝 탭 도달 가능해야 함
  const last = nav.querySelector("a[href='/now/']") || nav.lastElementChild;
  const r = last.getBoundingClientRect();
  return r.right <= window.innerWidth + 2;
});
check("⑧ 375px: 마지막 탭 도달 가능(nav 스크롤)", navReach);
await pm.screenshot({ path: "verify-now-mobile.png" });
await pm.close();

console.log(`\n${pass}/${pass + fail} 판정 통과`);
await b.close();
process.exit(fail ? 1 : 0);
