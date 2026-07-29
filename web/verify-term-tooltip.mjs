// docs/45 — 용어 인라인 툴팁 실렌더 검증.
// 밑줄→팝오버→용어집 링크 / 자기 노트 제외 / flag off 평문 / 드로어 / 다크 대비.
import { chromium } from "playwright";

// ⛔ 라이브 계정 비밀번호를 코드에 두지 않는다(보안 스캔 F1/F3/F12).
//    실행: APP_TEST_USER=... APP_TEST_PASS=... node <이 파일>
const TEST_USER = process.env.APP_TEST_USER || "admintest";
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — 검증 계정 비밀번호는 환경변수로만 받습니다.");
  process.exit(2);
}
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const b = await chromium.launch();
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log((ok ? "✅" : "❌") + " " + n + (d ? " — " + d : "")); ok ? pass++ : fail++; };

const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.request.post(BASE + "/api/app/auth/login", { data: { username: TEST_USER, password: TEST_PW } }); // docs/44 게이트

// 0) 데이터: terms-tooltip.json + 매칭 가능한 실문서 동적 탐색(스크립트 낡음 방지)
const terms = await (await ctx.request.get(BASE + "/terms-tooltip.json")).json();
check("0) terms-tooltip.json 로드(80개+)", Array.isArray(terms) && terms.length >= 80, String(terms.length));
const idx = await (await ctx.request.get(BASE + "/search-index.json")).json(); // { slug: 본문 }
// 용어집 문서 자신은 제외하고, 어떤 용어를 '단어 시작'으로 포함하는 문서를 찾는다
const termSet = terms.filter((t) => t.t.length >= 3); // 테스트는 3자+ 용어로(우연 매칭 최소화)
let target = null, hitTerm = null;
for (const [slug, text] of Object.entries(idx)) {
  if (terms.some((t) => t.s === slug)) continue;
  for (const t of termSet) {
    const re = new RegExp(`(?<![가-힣A-Za-z0-9])${t.t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    if (re.test(text || "")) { target = { slug }; hitTerm = t; break; }
  }
  if (target) break;
}
check("0b) 용어 포함 실문서 탐색", !!target, target ? `${target.slug} ⊃ ${hitTerm.t}` : "없음");

// 1) 문서 페이지: 점선 밑줄 스팬 렌더
const p = await ctx.newPage();
await p.goto(`${BASE}/d/${encodeURIComponent(target.slug)}/`, { waitUntil: "load" });
await p.waitForTimeout(1800);
const hits = await p.locator('[class*="Terms_hit"], span[class*="hit"][role="button"]').count();
check("1) 용어 밑줄 스팬 렌더(1개+)", hits >= 1, `${hits}개`);

// 2) 호버 → 팝오버(정의 + 용어집 링크 + 미검수 배지)
const first = p.locator('span[class*="hit"][role="button"]').first();
const firstTermName = (await first.innerText()).trim();
await first.hover();
await p.waitForTimeout(400);
const pop = p.locator('[role="tooltip"]');
check("2) 호버 → 팝오버 노출", (await pop.count()) === 1);
const popText = await pop.innerText().catch(() => "");
check("2b) 팝오버에 용어명+정의", popText.includes(firstTermName) && popText.length > firstTermName.length + 10);
const entry = terms.find((t) => t.t === firstTermName);
check("2c) '용어집에서 보기' 링크 → 용어 노트", entry
  ? decodeURIComponent((await pop.locator("a").getAttribute("href")) || "").includes(`/d/${entry.s}/`)
  : false);
if (entry && !entry.r) check("2d) 미검수 용어 '검수 전 초안' 배지", popText.includes("검수 전 초안"));
await p.screenshot({ path: "verify-term-tooltip.png" });

// 3) 팝오버 링크 클릭 → 용어 노트 페이지 이동
await pop.locator("a").click();
await p.waitForTimeout(1200);
check("3) 링크 클릭 → 용어 노트 이동", decodeURIComponent(p.url()).includes(`/d/${entry.s}/`), decodeURIComponent(p.url()));

// 4) 용어 자기 노트: 자기 자신은 밑줄 금지(selfSlug)
const selfHits = await p.locator('span[class*="hit"][role="button"]', { hasText: entry.t }).count();
check("4) 자기 노트에서 자기 용어 밑줄 없음", selfHits === 0, `${selfHits}개`);

// 5) flag off → 평문(밑줄 0) — flags 응답 고정으로 재현
const ctxOff = await b.newContext();
await ctxOff.request.post(BASE + "/api/app/auth/login", { data: { username: TEST_USER, password: TEST_PW } });
await ctxOff.route("**/api/app/flags**", async (route) => {
  const r = await route.fetch();
  const j = await r.json();
  j.term_tooltips = false;
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(j) });
});
const poff = await ctxOff.newPage();
await poff.goto(`${BASE}/d/${encodeURIComponent(target.slug)}/`, { waitUntil: "load" });
await poff.waitForTimeout(1500);
check("5) flag off: 밑줄 0(평문 복귀)", (await poff.locator('span[class*="hit"][role="button"]').count()) === 0);
await ctxOff.close();

// 6) 드로어(browse ?doc=)에서도 동작 + fixed 팝오버가 overflow에 안 잘림
const pd = await ctx.newPage();
await pd.goto(`${BASE}/browse/?doc=${encodeURIComponent(target.slug)}`, { waitUntil: "load" });
await pd.waitForTimeout(2200);
const dHit = pd.locator('span[class*="hit"][role="button"]').first();
check("6) 드로어 본문에도 밑줄", (await dHit.count()) === 1 || (await pd.locator('span[class*="hit"]').count()) >= 1);
await dHit.hover();
await pd.waitForTimeout(400);
const dPop = pd.locator('[role="tooltip"]');
check("6b) 드로어 팝오버 노출·가시(fixed)", (await dPop.count()) === 1 && (await dPop.isVisible()));
// ⚠ isVisible()은 '화면 밖'을 걸러내지 못한다 — 드로어(.panel)의 translateX가 position:fixed의
//   기준을 가로채면 팝오버가 뷰포트 밖으로 밀리는데도 isVisible()은 true다(2026-07-20 실버그).
//   → 뷰포트 안에 실제로 들어와 있는지까지 판정한다(body 포털 회귀 방지).
{
  const box = await dPop.boundingBox();
  const vp = pd.viewportSize();
  const inside = !!box && box.x >= -2 && box.y >= -2 &&
    box.x + box.width <= vp.width + 2 && box.y + box.height <= vp.height + 2;
  check("6c) 드로어 팝오버가 뷰포트 안(transform 조상 탈출)", inside,
    box ? `x=${Math.round(box.x)} y=${Math.round(box.y)} w=${Math.round(box.width)} (vp ${vp.width}×${vp.height})` : "박스 없음");
  const portaled = await dPop.evaluate((el) => el.parentElement === document.body);
  check("6d) 팝오버가 body 포털로 렌더", portaled);
  // 클릭으로도 열려야(사용자 보고: 클릭 무반응)
  await pd.mouse.move(5, 5);
  await pd.waitForTimeout(400);
  await dHit.click();
  await pd.waitForTimeout(350);
  check("6e) 드로어에서 클릭으로도 팝오버 표시", (await pd.locator('[role="tooltip"]').count()) === 1);
}
await pd.screenshot({ path: "verify-term-tooltip-drawer.png" });

// 7) 다크: 팝오버 대비
const pk = await ctx.newPage();
await pk.addInitScript(() => localStorage.setItem("kei-theme", "dark"));
await pk.goto(`${BASE}/d/${encodeURIComponent(target.slug)}/`, { waitUntil: "load" });
await pk.waitForTimeout(1500);
await pk.locator('span[class*="hit"][role="button"]').first().hover();
await pk.waitForTimeout(400);
const lum = await pk.locator('[role="tooltip"] b').first().evaluate((el) => {
  const m = getComputedStyle(el).color.match(/\d+/g).map(Number);
  return (m[0] + m[1] + m[2]) / 3;
});
check("7) 다크: 팝오버 제목 밝음", lum > 180, String(Math.round(lum)));
await pk.screenshot({ path: "verify-term-tooltip-dark.png" });

console.log(`\n${pass}/${pass + fail} 판정 통과`);
await b.close();
process.exit(fail ? 1 : 0);
