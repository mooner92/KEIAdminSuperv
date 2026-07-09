// v1.1 관리자 UX 개편 검증(docs/21) — 탭·해시 딥링크·코퍼스 필터·제외 문서함·플래그 컴팩트 (dev 3101).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const ctx = await b.newContext();
let r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "admintest", password: "admtest123" } });
ok(r.ok(), `0) 관리자 로그인 (${r.status()})`);
const p = await ctx.newPage({ viewport: { width: 1440, height: 1300 } });

// ① 탭 + 해시 딥링크
await p.goto(`${BASE}/admin/#corpus`, { waitUntil: "load" });
await p.waitForTimeout(2500);
let body = await p.textContent("body");
ok((await p.locator('[aria-label="관리자 메뉴"] [role="tab"]').count()) === 3, "1) 탭 3개(대시보드·코퍼스·플래그)");
ok(body.includes("전체 목록") && body.includes("제외 문서함"), "2) #corpus 딥링크 → 코퍼스 탭 직행");

// ② 코퍼스: Explorer형 필터 + 페이지네이션
ok(body.includes("필터") && body.includes("구분") && body.includes("색인 상태"), "3) 좌측 필터 패널(구분·분류·검수·색인)");
ok(/\d+ \/ \d+/.test(body), "4) 페이지네이션");
await p.locator("label", { hasText: "규정집" }).first().locator("input").check();
await p.waitForTimeout(500);
body = await p.textContent("body");
ok(/1\d\d건/.test(body), "5) 구분 필터(규정집) → 건수 축소");

// ③ 제외 문서함 흐름: 제외 → 전체 목록에서 사라짐 → 제외함에 '⛔제외됨'+복귀
await p.locator('input[aria-label="코퍼스 검색"]').fill("복무규정");
await p.waitForTimeout(500);
await p.locator('button:has-text("색인 제외")').first().click();
await p.waitForTimeout(1200);
body = await p.textContent("body");
ok(!body.includes("전결") && (await p.locator('[class*="corpusRow"]').filter({ hasText: /^복무규정/ }).count()) === 0, "6) 제외 → 전체 목록에서 사라짐");
await p.locator('button:has-text("제외 문서함")').click();
await p.waitForTimeout(600);
body = await p.textContent("body");
ok(body.includes("삭제된 것이 아닙니다"), "7) 제외 문서함 안내문");
ok(body.includes("⛔ 제외됨") && body.includes("↩ 복귀"), "8) '⛔제외됨' 배지 + 복귀 버튼");
await p.screenshot({ path: "verify-admin-ux-excluded.png" });
await p.locator('button:has-text("↩ 복귀")').first().click();
await p.waitForTimeout(1200);
body = await p.textContent("body");
ok(body.includes("제외된 문서가 없어요"), "9) 복귀 → 제외 문서함 비움(원상)");

// ④ 플래그 탭: 컴팩트·검색·상태칩·아코디언
await p.locator('[role="tab"]', { hasText: "기능 플래그" }).click();
await p.waitForTimeout(800);
ok(p.url().includes("#flags"), "10) 탭 전환 시 해시 갱신");
const rows = p.locator('[class*="flagRowC"]');
ok((await rows.count()) >= 8, `11) 컴팩트 플래그 행 (${await rows.count()}개)`);
await p.locator('input[aria-label="플래그 검색"]').fill("corpus");
await p.waitForTimeout(400);
ok((await rows.count()) === 1, "12) 플래그 검색 필터");
await rows.first().click();
await p.waitForTimeout(300);
body = await p.textContent("body");
ok(body.includes("소유 ") && body.includes("만료 "), "13) 행 클릭 → 상세 펼침(아코디언)");
await p.screenshot({ path: "verify-admin-ux-flags.png" });
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 관리자 UX 개편 검증 통과");
process.exit(fails.length ? 1 : 0);
