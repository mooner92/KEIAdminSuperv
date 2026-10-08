// 에이전트 진행 표시 실렌더 검증(docs/74 §7) — flag agent_chat ON 상태의 dev(3101)에서 실행.
// 질문을 보내고 답변 자리의 단계 목록(✓ 지난 단계 · 점멸 지금 단계)이 실제로 쌓이는지, 끝나면 답으로
// 교체되는지 본다. ⛔ 플래그는 이 스크립트가 바꾸지 않는다(호출자가 켜고 끈다 — 전역 플래그라 짧게).
//   실행: set -a; . tools/.test_credentials; set +a; cd web && node verify-agent-progress.mjs
import { chromium } from "playwright";

const USER = process.env.APP_TEST_USER || "b6test";
const PW = process.env.APP_TEST_PASS;
if (!PW) {
  console.error("❌ APP_TEST_PASS 미설정 — 검증 계정 비밀번호는 환경변수로만 받습니다.");
  process.exit(2);
}
const BASE = process.env.VERIFY_BASE || "http://localhost:3100";
const SHOT = process.env.SHOT_DIR || "/tmp";
const Q = process.env.VERIFY_Q || "국내출장 다녀와서 복명서는 언제까지 내야 해?";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅" : "❌") + " " + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: USER, password: PW } });
const p = await ctx.newPage({ viewport: { width: 1280, height: 900 } });
// 새 대화(/?new=1) — 기존 대화에 이어 쓰면 이전 답의 👍 버튼 때문에 완료 판정이 즉시 참이 된다(실측)
await p.goto(`${BASE}/?new=1`, { waitUntil: "load" });
await p.waitForTimeout(1500);
const thumbs = 'button[title="도움이 됐어요"]';
const before = await p.locator(thumbs).count();
await p.fill('textarea[placeholder^="행정 업무"]', Q);
await p.click('button[aria-label="보내기"]');

// 단계 목록을 1.5초마다 샘플링 — 본 적 있는 라벨을 순서대로 모은다
const seen = [];
let shotTaken = false;
const t0 = Date.now();
let answered = false;
while (Date.now() - t0 < 420000) {
  const items = await p.locator('ol[aria-label="답변 준비 과정"] li').allInnerTexts().catch(() => []);
  for (const it of items) {
    const label = it.replace(/^✓\s*/, "").trim();
    if (label && !seen.includes(label)) seen.push(label);
  }
  if (!shotTaken && items.length >= 3) {
    await p.screenshot({ path: `${SHOT}/agent-progress-mid.png` });
    shotTaken = true;
  }
  if ((await p.locator(thumbs).count()) > before) { answered = true; break; }
  await p.waitForTimeout(1500);
}
const secs = Math.round((Date.now() - t0) / 1000);
console.log(`관측한 단계(${seen.length}개, ${secs}s):\n  - ` + seen.join("\n  - "));
await p.screenshot({ path: `${SHOT}/agent-progress-done.png` });

ok(seen.length >= 3, "1) 진행 단계가 3개 이상 쌓임");
ok(seen.some((s) => s.includes("관련 규정")), "2) 1차 검색 단계 표시");
ok(seen.some((s) => s.includes("점검")), "3) 근거 점검 단계 표시");
ok(seen.some((s) => s.includes("작성") || s.includes("검증")), "4) 작성·검증 단계 표시");
ok(shotTaken, "5) 진행 중 화면 캡처(3단계 이상 시점)");
ok(answered, "6) 답변 완료(피드백 버튼 노출)");
const bubble = (await p.locator("[class*=aiBubble], [class*=bubble]").last().innerText().catch(() => "")) || "";
ok(bubble.includes("최종 판단은"), "7) 최종 답변 본문 표시(면책 포함)");
ok(!(await p.locator('ol[aria-label="답변 준비 과정"]').count()), "8) 완료 후 단계 목록은 답변으로 교체");

await b.close();
if (fails.length) { console.log(`\n❌ ${fails.length}건 실패`); process.exit(1); }
console.log("\n✅ 에이전트 진행 표시 실렌더 통과");
