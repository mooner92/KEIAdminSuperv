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
await pr.waitForTimeout(800);
const rmOpacity = await pr.evaluate(() => {
  const el = document.querySelector("[data-reveal]");
  return el ? getComputedStyle(el).opacity : "?";
});
check("⑤ reduced-motion: 즉시 표시(opacity 1)", rmOpacity === "1", rmOpacity);
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
  return t.includes("로그인") && !t.includes("서비스 소개 자세히 보기");
}, undefined, { timeout: 8000 }).then(() => true).catch(() => false);
check("⑥ flag off: '/' 기존 Login 폼(랜딩 미노출)", offHome);
await ctxOff.close().catch(() => {});

// ⑦ 비로그인 + flag on — 컴팩트 홈(로그인 카드 첫 화면 가시) + track 전송 0건
const ctxAnon = await b.newContext({ viewport: { width: 1280, height: 900 } });
const pa = await ctxAnon.newPage();
let anonTracks = 0;
pa.on("request", (r) => { if (r.url().includes("/api/app/track")) anonTracks++; });
await pa.goto(BASE + "/", { waitUntil: "load" });
const compact = await pa.waitForFunction(() => document.body.innerText.includes("서비스 소개 자세히 보기"),
  undefined, { timeout: 8000 }).then(() => true).catch(() => false);
check("⑦ 비로그인 '/': 컴팩트 랜딩", compact);
const loginVisible = await pa.evaluate(() => {
  const input = document.querySelector('input[autocomplete="username"]');
  if (!input) return false;
  const r = input.getBoundingClientRect();
  return r.top > 0 && r.bottom < window.innerHeight; // 스크롤 없이 첫 화면에서 로그인 도달(§7)
});
check("⑦ 로그인 카드 첫 화면 가시(2클릭 이내 도달)", loginVisible);
await pa.waitForTimeout(1500);
check("⑦ 비로그인 track 전송 0건(401 노이즈 근절)", anonTracks === 0, String(anonTracks));
await pa.screenshot({ path: "verify-landing-home.png" });
await ctxAnon.close().catch(() => {});

// ⑨ 시작페이지 스크롤 0(사용자 요청) — 비로그인 '/'에서 푸터까지 한 화면(1900×983·1512×860)
for (const vp of [{ width: 1900, height: 983 }, { width: 1512, height: 860 }]) {
  const cno = await b.newContext({ viewport: vp });
  const pno = await cno.newPage();
  await pno.goto(BASE + "/", { waitUntil: "load" });
  await pno.waitForFunction(() => document.body.innerText.includes("서비스 소개") || document.body.innerText.includes("로그인"),
    undefined, { timeout: 8000 }).catch(() => {});
  await pno.waitForTimeout(800);
  const fit = await pno.evaluate(() => {
    const footer = document.querySelector("footer");
    return {
      noScroll: document.documentElement.scrollHeight <= window.innerHeight + 1,
      footerVisible: footer ? footer.getBoundingClientRect().bottom <= window.innerHeight + 1 : false,
    };
  });
  check(`⑨ ${vp.width}×${vp.height} 비로그인 '/': 스크롤 0 + 푸터 가시`, fit.noScroll && fit.footerVisible, JSON.stringify(fit));
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
