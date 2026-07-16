// docs/32 §7 수용 기준 실렌더 검증 — 🐛 버그리포트 탭(카드·버전 배지·접기·flag 게이트).
import { chromium } from "playwright";
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const b = await chromium.launch();
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log((ok ? "✅" : "❌") + " " + n + (d ? " — " + d : "")); ok ? pass++ : fail++; };

const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.request.post(BASE + "/api/app/auth/login", { data: { username: "admintest", password: "admtest123" } });
// ⚠ 토글은 같은 오리진 프록시로 — 9001 직접 호출은 로그인 쿠키(3101 오리진)가 안 붙어 무권한
const setFlag = (enabled) =>
  ctx.request.post(BASE + "/api/app/flags/bug_reports", { data: { enabled } });

await setFlag(true);
const p = await ctx.newPage();
await p.goto(BASE + "/changelog/", { waitUntil: "load" });
await p.waitForTimeout(1200);

// ① 탭 노출 + 진입
const tab = p.locator('button[role="tab"]', { hasText: "버그리포트" });
check("① 🐛 버그리포트 탭 노출", (await tab.count()) === 1);
await tab.click();
await p.waitForTimeout(300);

// ② 카드 목록 — 최신·심각도 순(개수는 노트 수만큼, 하드코딩 금지 — 드리프트 방지)
const cards = p.locator("details");
const n = await cards.count();
check("② 버그리포트 카드 노출(≥6)", n >= 6, `${n}건`);
const firstText = await cards.first().innerText();
check("② 첫 카드 = 높음 심각도(정렬)", firstText.includes("높음"));

// ③ 배지: 버전·영역·날짜
check("③ 버전 배지 vYYYY.MM.DD", /v\d{4}\.\d{2}\.\d{2}/.test(firstText));
check("③ 영역 칩", /서식 다운로드|검색 품질|답변 품질|화면/.test(firstText));

// ④ 펼치면 증상→원인→해결→개선 효과 섹션 렌더
await cards.first().locator("summary").click();
await p.waitForTimeout(300);
const opened = await cards.first().innerText();
const secs = ["증상", "원인", "해결", "개선 효과"];
check("④ 상세 섹션 4종 렌더", secs.every((s) => opened.includes(s)), secs.filter((s) => !opened.includes(s)).join(","));
await p.screenshot({ path: "verify-bugreport-open.png", fullPage: false });

// ⑤ 기존 탭 오염 없음 — '전체'에는 버그리포트 카드 미출현
await p.locator('button[role="tab"]', { hasText: "전체" }).click();
await p.waitForTimeout(300);
const allText = await p.innerText("body");
check("⑤ '전체' 탭에 버그리포트 본문 미혼입", !allText.includes("## 증상") && !allText.includes("재정렬 단계가 단어만"));

// ⑥ flag off → 탭 미노출(런타임 fetch라 리로드만으로 반영)
await setFlag(false);
await p.reload({ waitUntil: "load" });
await p.waitForTimeout(1500);
check("⑥ flag off 시 탭 미노출", (await p.locator('button[role="tab"]', { hasText: "버그리포트" }).count()) === 0);
await setFlag(true); // 복원

console.log(`\n${pass}/${pass + fail} 판정 통과`);
await b.close();
process.exit(fail ? 1 : 0);
