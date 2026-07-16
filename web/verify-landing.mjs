// docs/36 §7 수용 기준 실렌더 검증 — 소개(랜딩) 페이지(/about)·ScrollRail·비로그인 컴팩트 홈·flag off.
import { chromium } from "playwright";
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const b = await chromium.launch();
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log((ok ? "✅" : "❌") + " " + n + (d ? " — " + d : "")); ok ? pass++ : fail++; };

// ① /about (로그인 상태) — 6섹션 + ScrollRail
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
await ctx.request.post(BASE + "/api/app/auth/login", { data: { username: "admintest", password: "admtest123" } });
const p = await ctx.newPage();
await p.goto(BASE + "/about/", { waitUntil: "load" });
await p.waitForTimeout(2000);
const body = await p.innerText("body");
check("① 히어로 렌더", body.includes("지금 시작하기") && body.includes("출처가 달립니다"));
const sections = await p.locator("section[id]").count();
check("① 섹션 6개", sections === 6, String(sections));
const railBtns = await p.locator('nav[aria-label="페이지 섹션 이동"] button').count();
check("① ScrollRail 라벨 6개", railBtns === 6, String(railBtns));
check("① 가드레일 시연(거부 문구)", body.includes("규정에서 확인되지 않습니다"));
// 수치 카드 — 규정 원문 건수는 항상, '사람 검수 완료'는 값>0일 때만(0이면 숨김: 신뢰 역효과 방지)
check("① 수치 카드(실측치)", /규정 원문/.test(body) && /\d{2,}/.test(body) && !/\b0\s*\n?\s*사람 검수 완료/.test(body));
check("① 가입 3단계 스텝퍼", body.includes("6자리 코드"));
check("① 로그인 상태 → 질문하러 가기", body.includes("질문하러 가기"));
// docs/46 — 시네마틱 타이포 수용 기준
const heroTypo = await p.locator("h1").first().evaluate((el) => {
  const cs = getComputedStyle(el);
  return { size: parseFloat(cs.fontSize), ls: parseFloat(cs.letterSpacing) };
});
check("①-46 히어로 초대형 타이포(≥52px·음수 자간)", heroTypo.size >= 52 && heroTypo.ls < 0, JSON.stringify(heroTypo));
const gradEls = await p.evaluate(() =>
  [...document.querySelectorAll("h1 span")].filter((el) => {
    const cs = getComputedStyle(el);
    return (cs.webkitBackgroundClip === "text" || cs.backgroundClip === "text") && cs.backgroundImage.includes("gradient");
  }).length);
check("①-46 그라디언트 규율(정확히 1곳)", gradEls === 1, String(gradEls));
check("①-46 히어로 메타 스트립(실측 수치)", (await p.locator('[aria-label="코퍼스 규모(빌드타임 실측)"]').innerText()).match(/\d{2,}/) !== null);
const eyebrowNums = await p.locator('[class*="eyebrowNum"]').allInnerTexts();
check("①-46 넘버링 아이브로 01~05", eyebrowNums.length === 5 && eyebrowNums[0].includes("01") && eyebrowNums[4].includes("05"), eyebrowNums.join(","));
await p.screenshot({ path: "verify-landing.png", fullPage: true });

// ② ScrollRail 상호작용 — 클릭 점프 + aria-current + 키보드 Enter
const y0 = await p.evaluate(() => window.scrollY);
await p.locator('nav[aria-label="페이지 섹션 이동"] button', { hasText: "시작하기" }).click();
await p.waitForTimeout(900);
const y1 = await p.evaluate(() => window.scrollY);
check("② 레일 클릭 → 점프", y1 > y0 + 400, `${y0}→${y1}`);
const cur = await p.waitForFunction(() => {
  const el = document.querySelector('nav[aria-label="페이지 섹션 이동"] [aria-current="true"]');
  return el && el.textContent.includes("시작하기");
}, undefined, { timeout: 4000 }).then(() => true).catch(() => false);
check("② aria-current 하이라이트", cur);
await p.locator('nav[aria-label="페이지 섹션 이동"] button', { hasText: "소개" }).focus();
await p.keyboard.press("Enter");
await p.waitForTimeout(900);
check("② 키보드 Enter 점프", (await p.evaluate(() => window.scrollY)) < y1);

// ③ 다크 실측 — 본문 h2 밝음 + 히어로는 테마 불변 다크
const pd = await ctx.newPage();
await pd.addInitScript(() => localStorage.setItem("kei-theme", "dark"));
await pd.goto(BASE + "/about/", { waitUntil: "load" });
await pd.waitForTimeout(1500);
const darkH2 = await pd.evaluate(() => {
  const el = [...document.querySelectorAll("section h2")].at(-1);
  const m = getComputedStyle(el).color.match(/\d+/g).map(Number);
  return (m[0] + m[1] + m[2]) / 3;
});
check("③ 다크: 섹션 제목 밝음", darkH2 > 150, String(darkH2));
await pd.screenshot({ path: "verify-landing-dark.png" });
await pd.close();

// ④ 375px — 가로 스크롤 0 (레일은 880px 이하 숨김)
const pm = await ctx.newPage();
await pm.setViewportSize({ width: 375, height: 800 });
await pm.goto(BASE + "/about/", { waitUntil: "load" });
await pm.waitForTimeout(1200);
check("④ 375px 가로 스크롤 없음", await pm.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
check("④ 375px 레일 숨김", await pm.evaluate(() => {
  const r = document.querySelector('nav[aria-label="페이지 섹션 이동"]');
  return !r || getComputedStyle(r).display === "none";
}));
await pm.close();

// ⑤ reduced-motion — 리베일 요소가 즉시 보임(애니메이션 0)
const pr = await ctx.newPage();
await pr.emulateMedia({ reducedMotion: "reduce" });
await pr.goto(BASE + "/about/", { waitUntil: "load" });
await pr.waitForTimeout(1600); // 페이드(0.9s)+스태거(0.45s) 완료 대기
// docs/46 §2-9: reduce-motion에서는 '이동(translateY) 없음'만 보장(페이드 opacity는 접근성상 허용).
// 완료 후 전 요소가 보이고(op>0.9) transform none이어야 한다.
const rm = await pr.evaluate(() =>
  [...document.querySelectorAll("[data-reveal]")].slice(0, 6).map((el) => {
    const cs = getComputedStyle(el);
    return { op: parseFloat(cs.opacity), tf: cs.transform };
  }));
check("⑤ reduced-motion: 이동 없음 + 최종 표시(op>0.9)",
  rm.length > 0 && rm.every((x) => x.op > 0.9 && (x.tf === "none" || x.tf === "matrix(1, 0, 0, 1, 0, 0)")),
  JSON.stringify(rm.map((x) => x.op.toFixed(2))));
await pr.close();

// ⑥ flag off(새 컨텍스트 + 평면 dict 응답 고정) — /about 준비 중 + '/' 기존 Login 폼
const ctxOff = await b.newContext();
await ctxOff.route("**/api/app/flags**", async (route) => {
  try {
    const r = await route.fetch();
    const j = await r.json();
    j.landing_page = false;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(j) });
  } catch { await route.abort().catch(() => {}); }
});
const poff = await ctxOff.newPage();
await poff.goto(BASE + "/about/", { waitUntil: "load" });
const offAbout = await poff.waitForFunction(() => document.body.innerText.includes("준비 중"),
  undefined, { timeout: 8000 }).then(() => true).catch(() => false);
check("⑥ flag off: /about 준비 중", offAbout);
await poff.goto(BASE + "/", { waitUntil: "load" });
const offHome = await poff.waitForFunction(() => {
  const t = document.body.innerText;
  return t.includes("로그인") && !t.includes("규정이 답합니다");  // 랜딩 히어로 문구 미노출
}, undefined, { timeout: 8000 }).then(() => true).catch(() => false);
check("⑥ flag off: '/' 기존 Login 폼(랜딩 미노출)", offHome);
await ctxOff.close().catch(() => {});

// ⑦ 비로그인 + flag on — 컴팩트 홈(로그인 카드 첫 화면 가시) + track 전송 0건
const ctxAnon = await b.newContext({ viewport: { width: 1280, height: 900 } });
const pa = await ctxAnon.newPage();
let anonTracks = 0;
pa.on("request", (r) => { if (r.url().includes("/api/app/track")) anonTracks++; });
await pa.goto(BASE + "/", { waitUntil: "load" });
// docs/47 통합 홈: 소개(히어로 문구)와 로그인 폼이 한 화면에 함께
const merged = await pa.waitForFunction(() => {
  const t = document.body.innerText;
  return t.includes("규정이 답합니다") && t.includes("로그인");
}, undefined, { timeout: 8000 }).then(() => true).catch(() => false);
check("⑦ 비로그인 '/': 통합 랜딩(소개+로그인)", merged);
const loginVisible = await pa.evaluate(() => {
  const input = document.querySelector('input[autocomplete="username"]');
  if (!input) return false;
  const r = input.getBoundingClientRect();
  return r.top > 0 && r.bottom < window.innerHeight; // 첫 화면에서 로그인 도달
});
check("⑦ 로그인 카드 첫 화면 가시(2클릭 이내 도달)", loginVisible);
await pa.waitForTimeout(1500);
check("⑦ 비로그인 track 전송 0건(401 노이즈 근절)", anonTracks === 0, String(anonTracks));
// 비로그인엔 앱 메뉴(GNB) 숨김 — 사용자 요청
const hdr = await pa.innerText("header");
check("⑦ 비로그인: GNB 앱 메뉴 숨김", !hdr.includes("규정 둘러보기") && !hdr.includes("관계 그래프") && !hdr.includes("지금 KEI"), hdr.replace(/\s+/g, " ").slice(0, 80));
await pa.screenshot({ path: "verify-landing-home.png" });
await ctxAnon.close().catch(() => {});

// ⑨ 통합 홈(docs/47 v2): 페이지 무스크롤 + 소개 컬럼 슬라이드 스냅 + 로그인 완전 부동
for (const vp of [{ width: 1900, height: 983 }, { width: 1440, height: 860 }]) {
  const cno = await b.newContext({ viewport: vp });
  const pno = await cno.newPage();
  await pno.goto(BASE + "/", { waitUntil: "load" });
  await pno.waitForFunction(() => document.body.innerText.includes("규정이 답합니다"),
    undefined, { timeout: 8000 }).catch(() => {});
  await pno.waitForTimeout(1200);
  const noPageScroll = await pno.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1);
  const intro = pno.locator('[class*="mergedIntro"]');
  const card = pno.locator('[class*="mergedLogin"]');
  const y0 = (await card.boundingBox().catch(() => null))?.y;
  await intro.hover();
  await pno.mouse.wheel(0, 120); // 휠 1틱 = 1슬라이드
  await pno.waitForTimeout(900);
  const st = await intro.evaluate((el) => ({ top: el.scrollTop, h: el.clientHeight }));
  const y1 = (await card.boundingBox().catch(() => null))?.y;
  const okAll = noPageScroll && Math.abs(st.top - st.h) < 6 && y0 != null && Math.round(y0) === Math.round(y1);
  check(`⑨ ${vp.width}×${vp.height} 슬라이드 스냅+로그인 부동(무페이지스크롤)`, okAll,
    `pageNoScroll=${noPageScroll} snap=${st.top}/${st.h} loginY=${Math.round(y0)}→${Math.round(y1)}`);
  await cno.close().catch(() => {});
}

// ⑧ 로그인 후 '/' 기존 채팅 불변 + footer '소개' 링크
await p.goto(BASE + "/", { waitUntil: "load" });
await p.waitForTimeout(1500);
const chatBody = await p.innerText("body");
check("⑧ 로그인 '/': 채팅 유지", (await p.locator("textarea, input[placeholder*='질문']").count()) > 0
  || chatBody.includes("무엇이든 물어보세요") || chatBody.includes("질문"));
check("⑧ footer 소개 링크", (await p.locator('footer a[href="/about/"]').count()) === 1);

console.log(`\n${pass}/${pass + fail} 판정 통과`);
await b.close();
process.exit(fail ? 1 : 0);
