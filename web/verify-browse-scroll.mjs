// 규정 찾기 스크롤 계약 회귀(2026-07-27) — 문서·서식 두 탭이 **같은 셸**을 쓰고
// 목록이 실제로 스크롤되는지. 실측 결함: 문서 탭은 자체 셸이라 목록 스크롤 컨테이너가 없었다
// (필터만 스크롤 · 아래 항목 도달 불가). 클래스명으로 '같은 컴포넌트'까지 검사한다.
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:3101";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: "test1234" } });
const p = await ctx.newPage();
let fail = 0;

const probe = async (label, clickTab) => {
  await p.goto(`${BASE}/browse/`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1600);
  if (clickTab) {
    const t = p.locator(`button:has-text("${clickTab}")`).first();
    if (await t.count()) { await t.click(); await p.waitForTimeout(1500); }
  }
  const r = await p.evaluate(() => {
    const out = { shell: false, listScrollable: null, sideScrollable: false };
    document.querySelectorAll("*").forEach((e) => {
      const cn = (e.className || "").toString();
      if (/BrowseShell_wrap/.test(cn)) out.shell = true;
      const cs = getComputedStyle(e);
      const scr = /auto|scroll/.test(cs.overflowY) && e.scrollHeight - e.clientHeight > 8;
      if (!scr) return;
      if (/BrowseShell_side/.test(cn)) out.sideScrollable = true;
      if (/BrowseUI_list/.test(cn)) out.listScrollable = { h: e.clientHeight, sh: e.scrollHeight };
    });
    return out;
  });
  const ok = r.shell && !!r.listScrollable;
  console.log(`  ${ok ? "✅" : "❌"} ${label}: 공용 셸=${r.shell} · 목록 스크롤=${r.listScrollable ? `${r.listScrollable.h}→${r.listScrollable.sh}` : "없음"} · 필터 스크롤=${r.sideScrollable}`);
  if (!ok) fail++;
  // 실제 휠 스크롤이 먹는지 — 목록 위에서 굴려 본다
  if (r.listScrollable) {
    const before = await p.evaluate(() => document.querySelector('[class*="BrowseUI_list"]').scrollTop);
    await p.locator('[class*="BrowseUI_list"]').first().hover();
    await p.mouse.wheel(0, 600);
    await p.waitForTimeout(400);
    const after = await p.evaluate(() => document.querySelector('[class*="BrowseUI_list"]').scrollTop);
    const moved = after > before;
    console.log(`     휠 스크롤: ${moved ? `✅ ${before}→${after}` : "❌ 안 움직임"}`);
    if (!moved) fail++;
  }
};
await probe("문서 탭", null);
await probe("서식 탭", "서식");
await b.close();
console.log(fail ? `⛔ 실패 ${fail}건` : "🎉 규정 찾기 스크롤 계약 통과 — 두 탭 동일 셸");
process.exit(fail ? 1 : 0);
