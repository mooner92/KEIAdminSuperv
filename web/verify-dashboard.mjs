// #5 운영자 대시보드 실렌더 검증: 관리자 /admin → 대시보드 카드 + 인기질문 + 콘텐츠 갭 + 플래그 공존.
// ⚠ dev(3101) 전용 — prod(3100)는 검증으로도 건드리지 않는다. 관리자는 dev 테스트 계정 admintest.
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
const fails = [];
const ok = (c, m) => {
  console.log((c ? "✅ " : "❌ ") + m);
  if (!c) fails.push(m);
};

const b = await chromium.launch();
const ctx = await b.newContext();
const r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: TEST_USER, password: TEST_PW } });
ok(r.ok(), `0) 관리자 로그인 (${r.status()})`);

const p = await ctx.newPage();
await p.goto(`${BASE}/admin/`, { waitUntil: "load" });
// 대시보드는 flagsManage 성공 후 stats를 체이닝 fetch → 등장까지 auto-wait
await p.waitForSelector("text=운영 대시보드", { timeout: 15000 }).catch(() => {});
await p.waitForTimeout(500);

ok((await p.locator("text=운영 대시보드").count()) > 0, "1) 운영 대시보드 제목");
ok((await p.locator("text=거부율").count()) > 0, "2) 거부율 카드");
ok((await p.locator("text=피드백").count()) > 0, "3) 피드백 카드");
ok((await p.locator("text=인기 질문").count()) > 0, "4) 인기 질문 섹션");
ok((await p.locator("text=콘텐츠 갭").count()) > 0, "5) 콘텐츠 갭 섹션");
// 플래그는 v1.1 관리자 UX 개편(docs/21)으로 별도 탭 — '공존'이 아니라 탭 존재+전환으로 판정
ok((await p.locator('[role="tab"]', { hasText: "기능 플래그" }).count()) > 0, "6) 기능 플래그 탭 존재");
ok((await p.locator("text=개인정보 보호").count()) > 0, "7) 개인정보 보호(k-익명) 안내 노출");

await p.screenshot({ path: "verify-dashboard.png", fullPage: true });
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 운영 대시보드 검증 통과");
process.exit(fails.length ? 1 : 0);
