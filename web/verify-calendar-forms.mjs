// docs/40 — 업무 캘린더 분리 + 서식 필터 실렌더 검증.
import { chromium } from "playwright";
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const b = await chromium.launch();
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log((ok ? "✅" : "❌") + " " + n + (d ? " — " + d : "")); ok ? pass++ : fail++; };
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.request.post(BASE + "/api/app/auth/login", { data: { username: "admintest", password: "admtest123" } });
const p = await ctx.newPage();

// ── 업무 캘린더 페이지 ──
await p.goto(BASE + "/calendar/", { waitUntil: "load" });
await p.waitForTimeout(1800);
check("① GNB '업무 캘린더' 탭", (await p.innerText("header")).includes("업무 캘린더"));
// docs/43: 매월(상시)은 슬림 스트립(기본 접힘·인라인 제목) → 펼치면 5건 상세
const stripInline = await p.locator('section[aria-label="매월 챙길 일"] a').count();
check("① 매월 스트립 인라인 제목 링크", stripInline >= 4, String(stripInline));
await p.locator('section[aria-label="매월 챙길 일"] button').click();
await p.waitForTimeout(300);
check("① 매월 펼치기 → 5건 상세", (await p.locator('section[aria-label="매월 챙길 일"] li').count()) === 5);
check("① 12개월 그리드 셀", (await p.locator('section[aria-label$="업무"]').count()) === 12);
const month = new Date().getMonth() + 1;
check(`① 이번 달(${month}월) 배지`, (await p.innerText("body")).includes("이번 달"));
check("① 이번 달 히어로", (await p.locator('section[aria-label="이번 달 하이라이트"]').count()) === 1);
const calLinks = await p.locator('a[href^="/d/"]').count();
check("① 제목=문서 링크 다수", calLinks >= 15, String(calLinks));
// docs/43: 그리드에서 칩·'관련 문서→' 반복 제거(제목 자체가 링크)
check("① 그리드에 '관련 문서 →' 반복 없음", !(await p.innerText("body")).includes("관련 문서 →"));
await p.screenshot({ path: "shot-calendar.png", fullPage: true });

// ── /now 캘린더 카드 컴팩트 + 링크 ──
await p.goto(BASE + "/now/", { waitUntil: "load" });
await p.waitForTimeout(1500);
check("② /now 캘린더 카드 컴팩트(월 칩 없음)", (await p.locator('[aria-label="월 선택"]').count()) === 0);
check("② /now → 캘린더 전체 보기 링크", (await p.locator('a[href="/calendar/"]').count()) >= 1);

// ── 서식 필터 ──
await p.goto(BASE + "/forms/", { waitUntil: "load" });
await p.waitForTimeout(1500);
check("③ 규정 필터 패널", (await p.locator('aside[aria-label="규정 필터"]').count()) === 1);
const before = await p.locator("table tbody tr").count();
const firstReg = p.locator('label input[type="checkbox"]').first();
await firstReg.check();
await p.waitForTimeout(500);
const after = await p.locator("table tbody tr").count();
check("③ 규정 필터 → 목록 축소", after > 0 && after < before, `${before}→${after}`);
check("③ 초기화 버튼 노출", (await p.getByText(/초기화/).count()) >= 1);
// 필터 내 규정 검색
await firstReg.uncheck();
await p.locator('input[aria-label="규정 필터 검색"]').fill("감사");
await p.waitForTimeout(400);
const regRows = await p.locator('aside[aria-label="규정 필터"] label').count();
check("③ 필터 내 규정 검색 동작", regRows >= 1 && regRows < 40, String(regRows));
// 서식명 검색 유지
await p.locator('input[aria-label="규정 필터 검색"]').fill("");
await p.locator('input[aria-label="서식 검색"]').fill("출장");
await p.waitForTimeout(500);
check("③ 서식 검색 유지", (await p.locator("table tbody tr").count()) > 0);
await p.screenshot({ path: "shot-forms.png" });

// ── 다크 실측(캘린더) ──
const pd = await ctx.newPage();
await pd.addInitScript(() => localStorage.setItem("kei-theme", "dark"));
await pd.goto(BASE + "/calendar/", { waitUntil: "load" });
await pd.waitForTimeout(1200);
const dark = await pd.evaluate(() => { const m = getComputedStyle(document.querySelector("h3")).color.match(/\d+/g).map(Number); return (m[0]+m[1]+m[2])/3; });
check("④ 다크: 월 제목 밝음", dark > 150, String(dark));
await pd.close();

console.log(`\n${pass}/${pass + fail} 판정 통과`);
await b.close();
process.exit(fail ? 1 : 0);
