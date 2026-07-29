// docs/38 §A: 상황 시작 칩 + 부서 문의 핸드오프 카드 검증 (dev 3101, 플래그 route 강제 on).
import { chromium } from "playwright";

// ⛔ 테스트 계정 비밀번호를 코드에 두지 않는다(보안 스캔 후속 — dev 계정 14개가
//    레포에 박힌 비밀번호로 열리던 것을 2026-07-29에 회전).
//    실행: set -a; . tools/.test_credentials; set +a; node <이 파일>
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — tools/.test_credentials 를 로드하세요.");
  process.exit(2);
}
const BASE = "http://localhost:3101";
const S = "/tmp/claude-21963/-KEIAdminSuperv/186b414b-da9d-4008-bd73-cef71d5504f3/scratchpad";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1360, height: 950 }, permissions: ["clipboard-read", "clipboard-write"] });
const r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: TEST_PW } });
ok(r.ok(), `0) 로그인 (${r.status()})`);
// 새 플래그 2개 강제 on(+trending은 off로 두고 상황칩과의 단독 배치 확인)
await ctx.route("**/app/flags", async (route) => {
  const res = await route.fetch();
  const f = await res.json();
  route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...f, situation_chips: true, handoff_card: true }) });
});
const p = await ctx.newPage();
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(1500);
// 빈 화면으로 — 새 대화
await p.click('button:has-text("새 대화")').catch(() => {});
await p.waitForTimeout(600);

// ① 상황 칩 렌더 + 정적 예시 대체 확인
const chip = p.getByRole("button", { name: /첫 출장을 가요/ });
ok(await chip.count() === 1, "1) 상황 칩 '첫 출장을 가요' 렌더");
ok(await p.getByRole("button", { name: "출장 여비는 어떻게 정산하나요?" }).count() === 0,
  "2) 정적 예시 4개는 대체되어 없음(난잡 방지)");
const more = p.getByRole("button", { name: /더 보기 \+/ });
ok(await more.count() === 1, "3) '더 보기 +N' 접힘 칩 존재");
await p.screenshot({ path: `${S}/situ-empty.png` });

// ② 칩 클릭 → 미니 카드(추천 질문+여정 링크)
await chip.click();
await p.waitForTimeout(300);
const qBtn = p.getByRole("button", { name: /국내출장 여비는 어떻게 정산하나요\?/ });
ok(await qBtn.count() === 1, "4) 카드에 추천 질문 노출");
ok(await p.locator('a[href*="/journey/?task="]').filter({ hasText: "업무 한 장" }).count() === 1, "5) 여정 딥링크 존재");
await p.screenshot({ path: `${S}/situ-card.png` });
// ③ 추천 질문 클릭 = 프리필(자동 전송 없음)
await qBtn.click();
await p.waitForTimeout(200);
const val = await p.locator("textarea").inputValue();
ok(val.includes("국내출장 여비"), `6) 입력창 프리필됨(자동 전송 없음): "${val.slice(0, 24)}…"`);
ok((await p.locator("ul li").count()) === 0 || (await p.getByText("무엇이 궁금하세요?").count()) === 1, "7) 메시지 전송 안 됨(빈 화면 유지)");
// ④ 더 보기 펼침
await more.click();
await p.waitForTimeout(200);
ok(await p.getByRole("button", { name: /고충을 신고하고 싶어요/ }).count() === 1, "8) 더 보기 → 후순위 칩 펼침");
await p.getByRole("button", { name: /^접기/ }).click();

// ⑤ 핸드오프 카드 — 규정 밖 질문으로 실제 거부 답변 유도
await p.locator("textarea").fill("");
await p.locator("textarea").fill("화성 이주 지원 수당은 얼마인가요?");
await p.click('button[aria-label="보내기"]');
console.log("   … LLM 거부 답변 대기(최대 240s)");
const card = p.getByText("담당 부서에 물어볼 준비를 도와드릴게요");
await card.waitFor({ timeout: 240000 }).catch(() => {});
ok(await card.count() === 1, "9) 거부 답변 아래 핸드오프 카드 노출");
await p.screenshot({ path: `${S}/handoff.png` });
// ⑥ 복사 버튼 → 클립보드 내용 검증
const btn = p.getByRole("button", { name: /문의 내용 복사/ });
if (await btn.count()) {
  await btn.click();
  await p.waitForTimeout(400);
  const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  ok(clip.includes("문의 준비") && clip.includes("화성 이주") && clip.includes("규정집 기준일"),
    `10) 복사 텍스트에 질문+기준일 포함(${clip.length}자)`);
  ok(await p.getByText(/복사됐어요/).count() === 1, "11) '✓ 복사됐어요' 피드백 표시");
  console.log("---- 복사된 텍스트 ----\n" + clip + "\n----");
} else { ok(false, "10) 복사 버튼 없음"); }

// ⑦ 다크 + 모바일 뷰
const m = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true });
await m.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: TEST_PW } });
// 빈 새 채팅을 API로 미리 생성 → 페이지 로드시 최신(빈) 채팅 자동 선택 = 빈 화면(칩 노출)
await m.request.post(`${BASE}/api/app/chats`, { data: {} });
await m.route("**/app/flags", async (route) => {
  const res = await route.fetch(); const f = await res.json();
  route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...f, situation_chips: true, handoff_card: true }) });
});
const mp = await m.newPage();
await mp.addInitScript(() => { try { localStorage.setItem("kei-theme", "dark"); } catch {} });
await mp.goto(`${BASE}/`, { waitUntil: "load" });
await mp.waitForTimeout(1800);
await mp.getByRole("button", { name: /첫 출장을 가요/ }).click().catch(() => {});
await mp.waitForTimeout(300);
const mCard = await mp.getByText("업무 한 장으로 전체 흐름 보기").count();
ok(mCard === 1, "12) 모바일(390px)·다크에서 상황 카드 정상");
await mp.screenshot({ path: `${S}/situ-mobile-dark.png` });
await b.close();
console.log(fails.length ? `\n❌ 실패 ${fails.length}건` : "\n🎉 전부 통과");
process.exit(fails.length ? 1 : 0);
