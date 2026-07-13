// docs/31 §4.4 수용 기준 ⓐ~ⓖ 실렌더 검증 — 도움말 허브·FAQ(flag help_hub).
import { chromium } from "playwright";
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const b = await chromium.launch();
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log((ok ? "✅" : "❌") + " " + n + (d ? " — " + d : "")); ok ? pass++ : fail++; };
const lum = (rgb) => { const m = rgb.match(/\d+/g).map(Number); return (m[0] + m[1] + m[2]) / 3; };

// ⓑ flag on: 목차·FAQ 노출 + 초기 접힘
const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
const p = await ctx.newPage();
await p.goto(BASE + "/help/", { waitUntil: "load" });
await p.waitForTimeout(1500);
const body = await p.innerText("body");
check("ⓑ 목차 칩 노출", await p.locator('nav[aria-label="도움말 목차"] button').count() === 5);
check("ⓑ 잘 묻는 법 섹션", body.includes("잘 묻는 법"));
const nFaq = await p.locator("details").count();
check("ⓑ FAQ 아코디언 렌더(7개 — SMTP 문항 숨김)", nFaq === 7, `${nFaq}개`);
check("ⓑ 초기 전부 접힘", await p.locator("details[open]").count() === 0);
check("ⓑ 숨김 문항(인증 메일) 미노출", !body.includes("인증 메일이 안 와요"));

// ⓒ 아코디언 펼침/접힘
await p.locator("details summary").first().click();
await p.waitForTimeout(300);
check("ⓒ 펼침 동작", await p.locator("details[open]").count() === 1);
const opened = await p.innerText("details[open]");
check("ⓒ 펼침 시 답 노출", opened.includes("규정 용어"), opened.slice(0, 40));
await p.locator("details[open] summary").click();
await p.waitForTimeout(300);
check("ⓒ 접힘 동작", await p.locator("details[open]").count() === 0);

// ⓑ 목차 앵커 점프(FAQ로)
const y0 = await p.evaluate(() => window.scrollY);
await p.locator('nav[aria-label="도움말 목차"] button', { hasText: "FAQ" }).click();
await p.waitForTimeout(900);
const y1 = await p.evaluate(() => window.scrollY);
check("ⓑ 목차 → FAQ 앵커 점프", y1 > y0, `scrollY ${y0}→${y1}`);
await p.screenshot({ path: "verify-help-hub.png" });

// ⓓ 다크/라이트 색 실측(FAQ summary·본문)
const pd = await ctx.newPage();
await pd.addInitScript(() => localStorage.setItem("kei-theme", "dark"));
await pd.goto(BASE + "/help/", { waitUntil: "load" });
await pd.waitForTimeout(1200);
const cd = await pd.evaluate(() => ({
  sum: getComputedStyle(document.querySelector("details summary")).color,
  chip: getComputedStyle(document.querySelector('nav[aria-label="도움말 목차"] button')).color,
  bg: getComputedStyle(document.body).backgroundColor,
}));
check("ⓓ 다크: FAQ 제목 밝음", lum(cd.sum) > 180, cd.sum);
check("ⓓ 다크: 목차 칩 가독", lum(cd.chip) > 120, cd.chip);
await pd.screenshot({ path: "verify-help-hub-dark.png" });

// ⓔ 푸터 FAQ 링크 → #faq 도달
await p.goto(BASE + "/browse/", { waitUntil: "load" });
await p.waitForTimeout(800);
await p.click('footer a:has-text("FAQ")');
await p.waitForTimeout(1000);
check("ⓔ 푸터 FAQ → /help#faq", p.url().includes("/help") && p.url().includes("#faq"), p.url());
const inView = await p.evaluate(() => {
  const el = document.getElementById("faq");
  const r = el.getBoundingClientRect();
  return r.top >= 0 && r.top < window.innerHeight;
});
check("ⓔ FAQ 섹션이 화면 안", inView);

// ⓕ 규정 값 패턴 0건(금액·'N일 이내')
const txt = await p.innerText("body");
const money = txt.match(/\d{1,3}(,\d{3})+\s*원|\d+\s*만\s*원/g) || [];
const dued = txt.match(/\d+\s*일\s*이내/g) || [];
check("ⓕ 규정 값(금액) 0건", money.length === 0, money.join(","));
check("ⓕ 규정 값(기한) 0건", dued.length === 0, dued.join(","));

// ⓖ 닫기 토글과 충돌 없음(FAQ 앵커로 들어와도 '도움말 닫기'가 복귀)
await p.click('footer a:has-text("도움말 닫기")');
await p.waitForTimeout(800);
check("ⓖ 닫기 토글 → 이전 화면 복귀", p.url().includes("/browse"), p.url());

// ⓐ flag off: 현행과 동일(목차·FAQ 미노출) — 새 컨텍스트(캐시 없음) + flags 응답을 off로 고정
const ctxOff = await b.newContext();
await ctxOff.route("**/api/app/flags**", async (route) => {
  const r = await route.fetch();
  const j = await r.json();
  if (j.flags) j.flags.help_hub = false; else j.help_hub = false;
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(j) });
});
const poff = await ctxOff.newPage();
await poff.goto(BASE + "/help/", { waitUntil: "load" });
await poff.waitForTimeout(1500);
const offBody = await poff.innerText("body");
check("ⓐ flag off: FAQ 미노출", (await poff.locator("details").count()) === 0);
check("ⓐ flag off: 현행 섹션은 유지", offBody.includes("한계 — 꼭 알아두세요") && offBody.includes("할 수 있는 것"));

console.log(`\n${pass}/${pass + fail} 판정 통과`);
await b.close();
process.exit(fail ? 1 : 0);
