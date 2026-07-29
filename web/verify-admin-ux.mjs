// v1.1 관리자 UX 개편 검증(docs/21) — 탭·해시 딥링크·코퍼스 필터·제외 문서함·플래그 컴팩트 (dev 3101).
import { chromium } from "playwright";

// ⛔ 라이브 계정 비밀번호를 코드에 두지 않는다(보안 스캔 F1/F3/F12).
//    실행: set -a; . tools/.test_credentials; set +a; node <이 파일>
//    ⛔ admintest는 실재하지 않는 계정이다 — 기본값은 상주 픽스처 b6test.
//       관리자 화면(/admin) 테스트는 APP_TEST_USER=<APP_ADMINS 계정>을 함께 지정할 것.
const TEST_USER = process.env.APP_TEST_USER || "b6test";
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — 검증 계정 비밀번호는 환경변수로만 받습니다.");
  process.exit(2);
}
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const ctx = await b.newContext();
let r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: TEST_USER, password: TEST_PW } });
ok(r.ok(), `0) 관리자 로그인 (${r.status()})`);
const p = await ctx.newPage({ viewport: { width: 1440, height: 1300 } });

// ① 탭 + 해시 딥링크
await p.goto(`${BASE}/admin/#corpus`, { waitUntil: "load" });
await p.waitForTimeout(2500);
let body = await p.textContent("body");
// 탭 수는 기능 추가로 늘어난다(현재 6: 대시보드·코퍼스·표 복원·신뢰·사용자·플래그) — 핵심 3개 존재로 판정
const tabTexts = await p.locator('[aria-label="관리자 메뉴"] [role="tab"]').allInnerTexts();
ok(tabTexts.length >= 3 && ["대시보드", "코퍼스", "기능 플래그"].every((t) => tabTexts.some((x) => x.includes(t))),
  `1) 핵심 탭 존재(대시보드·코퍼스·플래그) — 총 ${tabTexts.length}개`);
ok(body.includes("전체 목록") && body.includes("제외 문서함"), "2) #corpus 딥링크 → 코퍼스 탭 직행");

// ② 코퍼스: Explorer형 필터 + 페이지네이션
ok(body.includes("필터") && body.includes("구분") && body.includes("색인 상태"), "3) 좌측 필터 패널(구분·분류·검수·색인)");
ok(/\d+ \/ \d+/.test(body), "4) 페이지네이션");
await p.locator("label", { hasText: "규정집" }).first().locator("input").check();
await p.waitForTimeout(500);
body = await p.textContent("body");
ok(/1\d\d건/.test(body), "5) 구분 필터(규정집) → 건수 축소");

// ③ 제외 문서함 흐름: 제외 → 전체 목록에서 사라짐 → 제외함에 '⛔제외됨'+복귀.
// ⚠ dev에는 의도적 제외(docs/28 옛 문서)가 상존 — '비어야 한다'가 아니라 '원상 복귀'로 판정하고,
//    복귀 클릭은 반드시 복무규정 행으로 스코프(first()는 남의 문서를 복귀시킬 수 있다).
const baseExcluded = Number((body.match(/제외 문서함 (\d+)/) || [])[1] || 0);
await p.locator('input[aria-label="코퍼스 검색"]').fill("복무규정");
await p.waitForTimeout(500);
await p.locator('button:has-text("색인 제외")').first().click();
// 실측: 제외된 문서는 전체 목록(현재 뷰)에서 사라진다(배지는 '제외 문서함' 뷰에서만).
// ⚠ 구판의 !body.includes("전결")는 필터 패널의 '전결' 분류 텍스트에 오탐 — 제거.
// ⚠ 토글 후 재조회는 비동기 — 고정 대기 대신 폴링(레이스 방지, E2E 규약)
const gone = await p.waitForFunction(
  () => ![...document.querySelectorAll('[class*="corpusRow"]')].some((el) => el.textContent.includes("복무규정")),
  undefined, { timeout: 8000 }).then(() => true).catch(() => false);
ok(gone, "6) 제외 → 전체 목록(현재 뷰)에서 사라짐");
await p.locator('button:has-text("제외 문서함")').click();
await p.waitForTimeout(600);
body = await p.textContent("body");
ok(body.includes("삭제된 것이 아닙니다"), "7) 제외 문서함 안내문");
ok(body.includes("⛔ 제외됨") && body.includes("↩ 복귀"), "8) '⛔제외됨' 배지 + 복귀 버튼");
await p.screenshot({ path: "verify-admin-ux-excluded.png" });
await p.locator('[class*="corpusList"] li', { hasText: "복무규정" })
  .locator('button:has-text("↩ 복귀")').first().click();
const restored = await p.waitForFunction((base) => {
  const noRow = ![...document.querySelectorAll('[class*="corpusList"] li')].some((el) => el.textContent.includes("복무규정"));
  const m = document.body.textContent.match(/제외 문서함 (\d+)/);
  return noRow && m && Number(m[1]) === base;
}, baseExcluded, { timeout: 8000 }).then(() => true).catch(() => false);
ok(restored, `9) 복귀 → 원상(제외 ${baseExcluded}건 유지, 복무규정 없음)`);

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
