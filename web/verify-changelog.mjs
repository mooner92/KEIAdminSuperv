// docs/32 §5 수용 기준 실렌더 검증 — 새로워진 점(배너·페이지·닫기 지속·재노출·flag off).
import { chromium } from "playwright";
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const b = await chromium.launch();
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log((ok ? "✅" : "❌") + " " + n + (d ? " — " + d : "")); ok ? pass++ : fail++; };

// 기대값은 빌드 산출물(changelog.json)에서 유도 — 노트가 늘어도 스크립트가 낡지 않게(드리프트 방지)
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const clog = await (await ctx.request.get(BASE + "/changelog.json")).json();
const latest = clog.latest; // { id, 요약 }
const total = clog.n;      // 전체 노트 수(빌드타임 집계)

// 푸터 '새로워진 점' 링크는 로그인 사용자에게만(비로그인 GNB/푸터 정리, docs/36) — 로그인 컨텍스트로 검증
await ctx.request.post(BASE + "/api/app/auth/login", { data: { username: "admintest", password: "admtest123" } });

// ⓑ 배너: 최신 노트 노출 → 닫기 → 재방문 미노출 → '새 노트'(id 변경) 재노출
const p = await ctx.newPage();
await p.goto(BASE + "/browse/", { waitUntil: "load" });
await p.waitForTimeout(1500);
let body = await p.innerText("body");
check("ⓑ 배너 노출(최신 요약)", body.includes("새로워진 점:") && body.includes(latest.요약.slice(0, 12)), latest.요약);
await p.screenshot({ path: "verify-changelog-banner.png" });
await p.click('button[aria-label="업데이트 알림 닫기"]');
await p.waitForTimeout(400);
check("ⓑ 닫기 즉시 사라짐", !(await p.innerText("body")).includes("새로워진 점:"));
await p.reload({ waitUntil: "load" });
await p.waitForTimeout(1500);
check("ⓑ 재방문 시 미노출(닫기 지속)", !(await p.innerText("body")).includes("새로워진 점:"));
// '새 노트' 시뮬레이션: 저장된 id를 다른 값으로 바꿔 재방문 → 다시 노출되어야 함
await p.evaluate(() => localStorage.setItem("kei-clog-dismissed", "다른-노트-id"));
await p.reload({ waitUntil: "load" });
await p.waitForTimeout(1500);
check("ⓑ 새 노트면 재노출", (await p.innerText("body")).includes("새로워진 점:"));

// ⓑ 배너 클릭 → /changelog 해당 카드 앵커(최신 노트 id — URL 인코딩 무관 비교)
await p.click("text=자세히 →");
await p.waitForTimeout(1000);
check("ⓑ 배너 클릭 → /changelog/#노트",
  decodeURIComponent(p.url()).includes(`/changelog/#${latest.id}`), decodeURIComponent(p.url()));

// ⓒ 페이지: 목록 전건·필터·다크 (기대 수는 changelog.json의 n에서 유도)
const cards = await p.locator("article").count();
check(`ⓒ 카드 전건(${total}건) 렌더`, cards === total, `${cards}건`);
await p.click('button[role="tab"]:has-text("신규")');
await p.waitForTimeout(300);
const catCards = await p.locator("article").count();
const catChips = await p.locator('article [data-cat="신규"]').count();
check("ⓒ 분류 필터(신규) — 보이는 카드 전부 신규", catCards >= 1 && catCards < total && catChips === catCards,
  `${catCards}건`);
await p.screenshot({ path: "verify-changelog-page.png" });
const pd = await ctx.newPage();
await pd.addInitScript(() => localStorage.setItem("kei-theme", "dark"));
await pd.goto(BASE + "/changelog/", { waitUntil: "load" });
await pd.waitForTimeout(1200);
const dark = await pd.evaluate(() => {
  const t = document.querySelector("article h2");
  const m = getComputedStyle(t).color.match(/\d+/g).map(Number);
  return (m[0] + m[1] + m[2]) / 3;
});
check("ⓒ 다크: 카드 제목 밝음", dark > 180, String(dark));
await pd.screenshot({ path: "verify-changelog-dark.png" });

// 푸터 링크
check("푸터 '새로워진 점' 링크", (await p.innerText("footer")).includes("새로워진 점"));

// ⓓ flag off — 새 컨텍스트 + flags 응답 고정(localStorage 캐시 회피 — help_hub 검증 교훈 재사용)
const ctxOff = await b.newContext();
await ctxOff.route("**/api/app/flags**", async (route) => {
  const r = await route.fetch();
  const j = await r.json();
  if (j.flags) j.flags.changelog = false; else j.changelog = false;
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(j) });
});
const poff = await ctxOff.newPage();
await poff.goto(BASE + "/browse/", { waitUntil: "load" });
await poff.waitForTimeout(1500);
const offBody = await poff.innerText("body");
check("ⓓ flag off: 배너·푸터 링크 미노출", !offBody.includes("새로워진 점"));
// ⓓ 보강(적대 리뷰): flag off 상태에서 /changelog/ 직접 URL 진입 시 본문(카드) 미노출
await poff.goto(BASE + "/changelog/", { waitUntil: "load" });
await poff.waitForTimeout(1500);
const offCards = await poff.locator("article").count();
check("ⓓ flag off: /changelog 직접 진입도 카드 0건(준비 중 안내)", offCards === 0 && (await poff.innerText("body")).includes("준비 중"), `${offCards}건`);

console.log(`\n${pass}/${pass + fail} 판정 통과`);
await b.close();
process.exit(fail ? 1 : 0);
