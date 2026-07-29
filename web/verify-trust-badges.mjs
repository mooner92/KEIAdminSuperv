// verify-trust-badges.mjs — P0 신뢰 게이트 UI 배지 실렌더 검증 (docs/22)
//   ① 부모상 경조금 질문 → 근거 패널 '⚠ 표 확인' 배지(P0-3) + 답변 유보/경고 렌더
//   ② 1년 미만 퇴직금 질문 → 적용범위 조문(제2조) 근거 카드 + 🔗 자동첨부 배지(P0-2)
// 실행: cd web && node verify-trust-badges.mjs  (dev 3101/9001 가동, article_integrity flag on)
import { chromium } from "playwright";

// ⛔ 라이브 계정 비밀번호를 코드에 두지 않는다(보안 스캔 F1/F3/F12).
//    실행: APP_TEST_USER=... APP_TEST_PASS=... node <이 파일>
const TEST_USER = process.env.APP_TEST_USER || "admintest";
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — 검증 계정 비밀번호는 환경변수로만 받습니다.");
  process.exit(2);
}

const BASE = process.env.BASE || "http://127.0.0.1:3101";
const USER = TEST_USER;
const PW = TEST_PW;
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
const r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: USER, password: PW } });
ok(r.ok(), `1) 로그인 (${r.status()})`);

const p = await ctx.newPage();
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(1500);

async function ask(q) {
  await p.click('button:has-text("새 대화")').catch(() => {});
  await p.waitForTimeout(500);
  await p.fill('textarea[placeholder^="행정 업무"]', q);
  await p.click('button[aria-label="보내기"]');
  await p.waitForSelector('button[title="도움이 됐어요"]', { timeout: 300000 });
  await p.waitForTimeout(800);
  // 근거 패널 펼치기(접힘 상태면 배지가 렌더되지 않음)
  const toggle = p.getByText(/근거 \d+개/).last();
  if (await toggle.count()) await toggle.click().catch(() => {});
  await p.waitForTimeout(600);
}

// ① P0-3 깨진 표
await ask("부모상 당하면 경조금 얼마 받아?");
ok((await p.getByText("⚠ 표 확인").count()) > 0, "2) '⚠ 표 확인' 배지 렌더(P0-3)");
ok((await p.getByText(/손상|수치 확인 필요|확정할 수 없/).count()) > 0, "3) 유보·경고 문구 렌더");
await p.screenshot({ path: "verify-trust-badges-table.png" });

// ② P0-2 적용범위 앵커
await ask("저 계약직인데 계약기간이 1년이 안 돼요. 퇴직금 받을 수 있나요?");
ok((await p.getByText("퇴직금규정 제2조").count()) > 0, "4) 적용범위 조문(제2조) 근거 카드(P0-2)");
ok((await p.getByText("🔗 적용범위 자동첨부").count()) > 0 || (await p.locator('[title*="적용되는지"]').count()) > 0, "5) 🔗 적용범위 자동첨부 배지 렌더");
await p.screenshot({ path: "verify-trust-badges-scope.png" });

await b.close();
console.log(`\n${fails.length === 0 ? "✅ 전부 통과" : `❌ 실패 ${fails.length}건`} — P0 신뢰 게이트 UI 배지`);
process.exit(fails.length === 0 ? 0 : 1);
