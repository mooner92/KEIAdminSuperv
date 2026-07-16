// docs/48 — 모바일(390px) 채팅·조문 중심 개편 실렌더 검증.
// GNB 3탭 · 채팅 첫 화면(드로어) · 둘러보기 필터 접힘(조문 우선) · 허브 도달성.
import { chromium } from "playwright";
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const b = await chromium.launch();
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log((ok ? "✅" : "❌") + " " + n + (d ? " — " + d : "")); ok ? pass++ : fail++; };
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.request.post(BASE + "/api/app/auth/login", { data: { username: "admintest", password: "admtest123" } });

// ① GNB: 핵심 3탭만(질문하기·규정 둘러보기·추가 기능) — 그래프·결재선·여정·캘린더는 숨김
const p = await ctx.newPage();
await p.goto(BASE + "/", { waitUntil: "load" });
await p.waitForTimeout(2000);
const tabs = (await p.locator("header nav a:visible").allInnerTexts()).map((t) => t.trim());
check("① GNB 3탭(채팅·조문 중심)", tabs.length === 3 && tabs.includes("질문하기") && tabs.includes("규정 둘러보기") && tabs.includes("추가 기능"), tabs.join(","));

// ② 채팅: 대화 목록이 위에 안 쌓임 — 입력창이 첫 화면, 드로어 열림/닫힘
check("② 입력창 첫 화면 가시", await p.evaluate(() => {
  const t = document.querySelector("textarea");
  if (!t) return false;
  const r = t.getBoundingClientRect();
  return r.top > 0 && r.bottom <= window.innerHeight;
}));
check("② 대화 목록 기본 숨김(드로어)", await p.evaluate(() => {
  const sb = document.querySelector('[class*="sidebar"]');
  return sb ? sb.getBoundingClientRect().right <= 0 : false;
}));
await p.locator('button[aria-label="대화 목록 열기"]').click();
await p.waitForTimeout(500);
check("② ☰ → 드로어 열림", await p.evaluate(() => {
  const sb = document.querySelector('[class*="sidebar"]');
  return sb ? sb.getBoundingClientRect().left >= -2 : false;
}));
await p.locator('[class*="sideBackdrop"]').click({ position: { x: 350, y: 400 } });
await p.waitForTimeout(500);
check("② 배경 탭 → 드로어 닫힘", await p.evaluate(() => {
  const sb = document.querySelector('[class*="sidebar"]');
  return sb ? sb.getBoundingClientRect().right <= 0 : false;
}));
await p.close();

// ③ 둘러보기: 필터 기본 접힘 → 목록(조문)이 첫 화면 · 토글로 펼침
const p2 = await ctx.newPage();
await p2.goto(BASE + "/browse/", { waitUntil: "load" });
await p2.waitForTimeout(2000);
check("③ 필터 기본 접힘", (await p2.locator('aside[class*="side"]:visible').count()) === 0);
check("③ 조문 목록 첫 화면(행 가시)", await p2.evaluate(() => {
  const row = document.querySelector('[class*="row"]');
  return row ? row.getBoundingClientRect().top < window.innerHeight : false;
}));
await p2.locator('button[aria-expanded]').first().click();
await p2.waitForTimeout(400);
check("③ 토글 → 필터 펼침(구분 체크박스)", (await p2.locator('aside input[type="checkbox"]:visible').count()) > 5);
await p2.close();

// ④ 허브: GNB에서 뺀 화면 도달성(그래프·결재선·업무 한 장 + 기존 3종)
const p3 = await ctx.newPage();
await p3.goto(BASE + "/now/", { waitUntil: "load" });
await p3.waitForTimeout(1800);
for (const href of ["/graph/", "/calendar/", "/changelog/"]) {
  check(`④ 허브 바로가기 ${href}`, (await p3.locator(`a[href="${href}"]`).count()) >= 1);
}
// 결재선·업무 한 장은 플래그 게이트 — 켜져 있으면 노출 확인(꺼져 있으면 skip 로그)
const flags = await (await ctx.request.get(BASE + "/api/app/flags")).json();
for (const [flag, href] of [["approval_finder", "/approval/"], ["journey_map", "/journey/"]]) {
  if (flags[flag]) check(`④ 허브 바로가기 ${href}(flag on)`, (await p3.locator(`a[href="${href}"]`).count()) >= 1);
  else console.log(`⏭ ${href} — flag ${flag} off(게이트 정상)`);
}
// ⑤ 가로 스크롤 없음(전 페이지 공통 계약)
for (const path of ["/", "/browse/", "/now/"]) {
  const pv = await ctx.newPage();
  await pv.goto(BASE + path, { waitUntil: "load" });
  await pv.waitForTimeout(1200);
  check(`⑤ ${path} 가로 스크롤 없음`, await pv.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await pv.close();
}

console.log(`\n${pass}/${pass + fail} 판정 통과`);
await b.close();
process.exit(fail ? 1 : 0);
