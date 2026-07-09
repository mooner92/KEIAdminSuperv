// v1 ⑬(S7) 탐색 마감 검증 — URL 딥링크·뒤로가기·norm 검색+mark·드로어 스택·TOC (dev 3101).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });

// ① 딥링크: ?doc= 진입 → 드로어 자동 오픈
await p.goto(`${BASE}/browse/?doc=3400_복무규정`, { waitUntil: "networkidle" });
await p.waitForTimeout(1600);
let d = await p.locator('[aria-label="문서 보기"]').textContent();
ok((d || "").includes("복무규정") && /제\d+조/.test(d || ""), "1) ?doc= 딥링크 → 드로어 자동 오픈");

// ② TOC 바 + 점프
const tocChips = p.locator('[class*="tocChip"]');
ok((await tocChips.count()) > 5, `2) 조문 TOC 바 렌더 (${await tocChips.count()}개)`);
await tocChips.filter({ hasText: "제19조" }).first().click();
await p.waitForTimeout(900);
const inView = await p.evaluate(() => {
  const el = document.getElementById("제19조");
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.top >= -30 && r.top < window.innerHeight * 0.5;
});
ok(inView, "3) TOC '제19조' 클릭 → 해당 조문으로 스크롤");

// ③ 드로어 내부 탐색 → ← 뒤로 스택 (백링크 클릭)
const drawer = p.locator('[aria-label="문서 보기"]');
const bl = drawer.locator('[class*="blList"] button').first();
if (await bl.count()) {
  const target = await bl.textContent();
  await bl.click();
  await p.waitForTimeout(1200);
  ok((await drawer.locator("h1").first().textContent() || "").includes((target || "").slice(0, 6)), "4) 내부 링크 이동");
  const back = drawer.locator('button:has-text("← 뒤로")');
  ok((await back.count()) > 0, "5) '← 뒤로' 버튼 노출");
  await back.click();
  await p.waitForTimeout(1000);
  ok(((await drawer.locator("h1").first().textContent()) || "").includes("복무규정"), "6) 뒤로 → 복무규정 복귀");
} else { ok(false, "4~6) 백링크 없음"); }

// ④ 전체화면 링크 앵커 유지
const href = await drawer.locator('a:has-text("전체화면")').getAttribute("href");
ok((href || "").includes("/d/"), `7) 전체화면 링크 (${href})`);

// ⑤ URL 동기화 + 브라우저 뒤로가기 → 드로어 닫힘
await drawer.locator('button[aria-label="닫기"]').click();
await p.waitForTimeout(500);
await p.locator('input[aria-label="검색"]').first().fill("복무 규정"); // 공백 포함(norm 검증)
await p.waitForTimeout(800);
let body = await p.textContent("body");
ok(body.includes("복무규정"), "8) norm 검색: '복무 규정'(공백)으로 매칭");
ok((await p.locator("mark").count()) > 0, "9) 제목 <mark> 강조");
await p.getByText("복무규정", { exact: true }).first().click();
await p.waitForTimeout(1000);
ok(p.url().includes("doc="), `10) 드로어 오픈 시 URL에 ?doc= (${new URL(p.url()).search})`);
await p.goBack();
await p.waitForTimeout(800);
ok(!p.url().includes("doc="), "11) 브라우저 뒤로가기 → URL 복원(드로어 닫힘)");
await p.screenshot({ path: "verify-explore.png" });
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 탐색 마감(⑬) 검증 통과");
process.exit(fails.length ? 1 : 0);
