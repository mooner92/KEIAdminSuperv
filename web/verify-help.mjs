// 도움말 다크 가독성 + 닫기 동선 실렌더 검증 (사용자 보고 버그).
import { chromium } from "playwright";
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
import { makeCheck } from "./verify-lib.mjs";
const { check, finish } = makeCheck();
const lum = (rgb) => { const m = rgb.match(/\d+/g).map(Number); return (m[0] + m[1] + m[2]) / 3; };

// ① 다크모드에서 h2/li/p가 밝은 글자인지(실측 버그: rgb(33,37,41)로 안 보였음)
await p.addInitScript(() => localStorage.setItem("kei-theme", "dark"));
await p.goto(BASE + "/help/", { waitUntil: "load" });
await p.waitForTimeout(1200);
const c = await p.evaluate(() => ({
  h2: getComputedStyle(document.querySelector("h2")).color,
  li: getComputedStyle(document.querySelector("li")).color,
  bg: getComputedStyle(document.body).backgroundColor,
}));
check("① 다크: h2 밝은 글자", lum(c.h2) > 180, c.h2);
check("① 다크: 본문(li) 밝은 글자", lum(c.li) > 180, c.li);
check("① 다크: 배경 어두움", lum(c.bg) < 60, c.bg);
await p.screenshot({ path: "verify-help-dark.png" });

// ② 푸터 토글: /help에서는 '도움말 닫기'로 바뀌고, 클릭 시 이전 화면 복귀
const label = await p.evaluate(() => [...document.querySelectorAll("footer a")].map(a => a.textContent.trim()).find(t => t.includes("도움말")));
check("② /help 푸터 라벨 = 닫기", label === "✕ 도움말 닫기", label);
// 홈→도움말→푸터 닫기→홈 복귀 시나리오
await p.goto(BASE + "/browse/", { waitUntil: "load" });
await p.waitForTimeout(800);
await p.click('footer a:has-text("도움말")');
await p.waitForTimeout(800);
check("② 푸터 도움말 → /help 이동", p.url().includes("/help"));
await p.click('footer a:has-text("도움말 닫기")');
await p.waitForTimeout(800);
check("② 닫기 → 이전 화면(/browse) 복귀", p.url().includes("/browse"), p.url());

// ③ 상단 ‹ 뒤로 버튼
await p.click('footer a:has-text("도움말")');
await p.waitForTimeout(800);
await p.click('button:has-text("‹ 뒤로")');
await p.waitForTimeout(800);
check("③ ‹ 뒤로 → 복귀", p.url().includes("/browse"), p.url());

// ④ 라이트 모드 회귀 없음
const p2 = await b.newPage();
await p2.addInitScript(() => localStorage.setItem("kei-theme", "light"));
await p2.goto(BASE + "/help/", { waitUntil: "load" });
await p2.waitForTimeout(1000);
const c2 = await p2.evaluate(() => ({
  li: getComputedStyle(document.querySelector("li")).color,
  bg: getComputedStyle(document.body).backgroundColor,
}));
check("④ 라이트: 어두운 글자/밝은 배경", lum(c2.li) < 90 && lum(c2.bg) > 200, JSON.stringify(c2));

await b.close();
process.exit(finish());
