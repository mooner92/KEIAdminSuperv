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
check("① GNB '지금 KEI' 탭", (await p.innerText("header")).includes("지금 KEI"));
const month = new Date().getMonth() + 1;
check(`① 캘린더 이번 달(${month}월) 헤더`, body.includes(`${month}월 챙길 일`));
// docs/39: 확정 항목 반입 후 — 월 항목 또는 빈 상태 문구 중 하나가 렌더(문자열 고정 의존 제거)
const calItems = await p.locator('section[aria-label="이번 달 챙길 일"] li').count();
check("① 캘린더 항목/빈 상태 렌더", calItems > 0 || body.includes("고유 일정이 아직 없어요"), `${calItems}개`);
// docs/39: 매월(상시) 섹션 + 대외업무 구분 칩
check("① 매월 챙길 일 섹션", body.includes("매월 챙길 일"));
check("① 대외업무 구분 칩", body.includes("대외업무"));
check("① 키워드 블록(로그인)", body.includes("요즘 많이 찾는 키워드"));
check("① 최근 개정 규정 5건", (await p.locator('section[aria-label="최근 개정된 규정"] li').count()) === 5);
check("① 새로워진 점 3건", (await p.locator('section[aria-label="새로워진 점"] li').count()) === 3);
check("① 오늘의 용어", body.includes("오늘의 용어"));
await p.screenshot({ path: "verify-now.png" });

// ①-2 월 선택 칩(스펙 §2) — 12개 + 클릭 시 해당 월로 전환
const chips = await p.locator('[aria-label="월 선택"] button').count();
check("①-2 월 칩 12개", chips === 12, String(chips));
const otherMonth = (month % 12) + 1;
await p.locator('[aria-label="월 선택"] button', { hasText: `${otherMonth}월` }).first().click();
await p.waitForTimeout(300);
check(`①-2 칩 클릭 → ${otherMonth}월 전환`, (await p.innerText("body")).includes(`${otherMonth}월 챙길 일`));
await p.locator('[aria-label="월 선택"] button', { hasText: `${month}월` }).first().click();
await p.waitForTimeout(200);

// ② 오늘의 용어 결정성 — 새로고침해도 같은 용어
const term1 = await p.locator('section[aria-label="오늘의 용어"] a').first().innerText();
await p.reload({ waitUntil: "load" });
await p.waitForTimeout(2000);
const term2 = await p.locator('section[aria-label="오늘의 용어"] a').first().innerText();
check("② 오늘의 용어 결정적(새로고침 동일)", term1 === term2, `${term1}`);

// ③ 사용량 track 발화(now_view + page_view)
check("③ track 발화", trackCalls.includes("now_view") && trackCalls.includes("page_view"), trackCalls.join(","));

// ④ 시즌 캘린더 데이터 로드 — 월 무관 고정 항목(매월 섹션)으로 판정. 접힌 details도 읽히게 textContent
const hasSeasonalData = await p.evaluate(() =>
  !!(document.body.textContent || "").match(/법인카드 모니터링|인력현황|연말정산|연차휴가 사용 점검/));
check("④ 시즌 캘린더 데이터 로드", hasSeasonalData);
// ④-2 확정 항목엔 '자료 확정 전' 배지가 없어야 함(월례 5건은 전부 확정).
// details가 접혀 있어도 읽히게 textContent로 판정
const everyTxt = await p.evaluate(() => {
  const d = [...document.querySelectorAll("details")].find((x) => (x.textContent || "").includes("매월 챙길 일"));
  return d ? d.textContent : "";
});
check("④-2 매월 항목 확정(배지 없음)", everyTxt.includes("법인카드") && !everyTxt.includes("자료 확정 전"));

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
