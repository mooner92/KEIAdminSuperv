// 모바일 셸(docs/54 v2) 실렌더 검증 — 하단 탭바·미니멀 헤더·더보기 메뉴·채팅 공존·데스크톱 무변경.
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "admintest", password: "admtest123" } });

const p = await ctx.newPage();
await p.setViewportSize({ width: 390, height: 844 });

// ① 채팅(홈): 하단 탭바 + 상단 내비 숨김 + 푸터 숨김 + 컴포저 보임
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(2600);
const bar = p.locator('nav[aria-label="모바일 메뉴"]');
ok(await bar.isVisible(), "1) 하단 탭바 표시");
const barBox = await bar.boundingBox();
ok(barBox && Math.abs(barBox.y + barBox.height - 844) < 2, `2) 탭바 화면 하단 고정(y+h=${Math.round((barBox?.y||0)+(barBox?.height||0))})`);
const topNavVisible = await p.locator('header nav a:has-text("질문하기")').isVisible().catch(() => false);
ok(!topNavVisible, "3) 상단 GNB 내비 숨김(탭바 전담)");
const footerVisible = await p.locator("footer").isVisible().catch(() => false);
ok(!footerVisible, "4) 푸터 숨김(링크는 더보기로)");
const composer = p.locator("textarea").first();
const compBox = await composer.boundingBox().catch(() => null);
ok(!!compBox && compBox.y + compBox.height <= (barBox?.y ?? 844), `5) 채팅 입력창이 탭바 위에 보임(y=${Math.round(compBox?.y || -1)})`);
const ov1 = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(ov1 <= 0, `6) 가로 오버플로 없음(${ov1}px)`);
await p.screenshot({ path: "m-shell-chat.png" });

// ② 더보기(/now): 목록형 메뉴 + 도움말·관리자 카드
await p.locator('nav[aria-label="모바일 메뉴"] a:has-text("더보기")').click();
await p.waitForTimeout(2200);
ok(p.url().includes("/now"), "7) ☰ 더보기 → /now 이동");
const body = await p.textContent("body");
ok(body.includes("도움말") && body.includes("관리자"), "8) 더보기에 도움말·관리자(관리자 계정) 항목");
const moreActive = await p.locator('nav[aria-label="모바일 메뉴"] a[aria-current="page"]').innerText();
ok(moreActive.includes("더보기"), `9) 더보기 탭 활성 표시(${moreActive.replace(/\n/g, " ")})`);
await p.screenshot({ path: "m-shell-more.png", fullPage: true });

// ③ 부가 페이지(그래프)에서도 더보기 탭 활성 유지 + 탭바 표시
await p.goto(`${BASE}/graph/`, { waitUntil: "load" });
await p.waitForTimeout(2200);
ok(await bar.isVisible(), "10) 부가 페이지(그래프)에도 탭바");
const ga = await p.locator('nav[aria-label="모바일 메뉴"] a[aria-current="page"]').innerText().catch(() => "");
ok(ga.includes("더보기"), "11) 그래프 = 더보기 계열 활성");

// ④ 규정 탭
await p.locator('nav[aria-label="모바일 메뉴"] a:has-text("규정")').click();
await p.waitForTimeout(2000);
ok(p.url().includes("/browse"), "12) 📚 규정 → /browse 이동");
await p.screenshot({ path: "m-shell-browse.png" });

// ⑤ 데스크톱(1440): 셸 미발동 — GNB·푸터 그대로, 탭바 없음
const pd = await ctx.newPage();
await pd.setViewportSize({ width: 1440, height: 1000 });
await pd.goto(`${BASE}/`, { waitUntil: "load" });
await pd.waitForTimeout(2200);
ok(await pd.locator('header nav a:has-text("질문하기")').isVisible(), "13) 데스크톱 GNB 유지");
ok(await pd.locator("footer").isVisible(), "14) 데스크톱 푸터 유지");
ok(!(await pd.locator('nav[aria-label="모바일 메뉴"]').isVisible().catch(() => false)), "15) 데스크톱 탭바 없음");

await b.close();
console.log(fails.length ? `\n❌ ${fails.length}건 실패` : "\n✅ 전부 통과");
process.exit(fails.length ? 1 : 0);
