// shots-readme.mjs — README 게재용 스크린샷 생성기(docs/img/).
//
// ⛔ 공개 레포에 올라가는 이미지다. 화면에 **ALIO 공개분(20_규정원문/ 규정집)과 국가 법령만**
//    보이게 한다. 아래는 공개해선 안 되는 층 — 스크린샷에 들어가면 유출이다.
//      · 10_업무가이드/ (research_rule_files 유래, 내부 전용·커밋 금지)
//      · 40_시스템/ ERP 상세가이드 (사내 시스템 사용법)
//      · 50_대외업무/ (운영 통계, 규정 아님)
//    그래서 채팅 질문은 근거가 regulation/uplaw로만 회수되는 것을 **미리 확인해** 고정했다
//    (2026-07-30 실측: '직원의 정년은 언제인가요?' → regulation 7 + uplaw 2 · 비공개층 0).
//    질문을 바꾸려면 반드시 x_sources의 type을 먼저 확인할 것. ⚠ 확인은 **웹 경로**
//    (`/api/rag/chat`)로 — `/v1`과 플래그가 달라 결과가 다르다. 실측 결함(2026-07-30):
//    '직원의 겸직은 허용되나요?'는 /v1에선 guide 0이었지만, 웹에선 원외겸직이 ACTION_FLOWS
//    여정이라 ERP 상세가이드가 자동첨부돼 비공개층이 화면에 떴다(아래 가드가 잡아냈다).
//
// 실행: set -a; . tools/.test_credentials; set +a; cd web && node shots-readme.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const TEST_USER = process.env.APP_TEST_USER || "b6test";
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — 검증 계정 비밀번호는 환경변수로만 받습니다.");
  process.exit(2);
}
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const OUT = process.env.SHOTS_OUT || "../docs/img";
// 근거가 규정집·국가법령으로만 채워지는 것을 확인한 질문(위 주석 참조)
const SAFE_Q = "직원의 정년은 언제인가요?";

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
// colorScheme을 고정한다 — 기본값은 OS를 따라가(테마 pref=system) 실행마다 이미지가 뒤집힌다.
const THEME = process.env.SHOTS_THEME === "dark" ? "dark" : "light";
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: THEME,
});
await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: TEST_USER, password: TEST_PW } });
const page = await ctx.newPage();

/** 배너·토스트처럼 매번 달라지는 요소는 닫아 이미지를 안정시킨다(diff 노이즈 방지).
 *  ⛔ 패치노트 배너는 **반드시** 닫는다 — 과거 보안 수정 문구("로그인 없이 문서가 열릴 수
 *  있던 경로를 막고…")가 그대로 찍혀 공개 레포에 취약점 이력이 노출된다(2026-07-30 실측). */
async function settle() {
  await page.addStyleTag({ content: `[class*="patchBanner"],[class*="Banner_"],[role="status"]{display:none !important}` });
  // ⛔ 닫기 버튼은 **정확한 aria-label로만** 집는다. /✕|닫기/ 같은 느슨한 매칭은 사이드바의
  //   '대화 삭제' 버튼(텍스트가 ✕)까지 걸어 픽스처 계정의 대화를 지울 수 있다(2026-07-30).
  await page.getByRole("button", { name: "업데이트 알림 닫기" }).click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(600);
}

/** 답변 블록 수. ⚠ getByText는 버튼과 그 내부 span을 **둘 다** 잡아 답변 1개를 2개로
 *  센다(2026-07-30 실측: 이력 3개가 6개로 보였다). 버튼 role로 세면 답변당 1이다. */
const answerCount = () => page.getByRole("button", { name: /근거\s*\d+개/ }).count();

async function shot(name, path, prep) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await settle();
  if (prep) await prep();
  await settle();  // 답변 대기 중 뜬 토스트도 걷어낸다
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ✓ ${name}.png  ← ${path}`);
}

// ① 채팅 — 규정집 근거만 나오는 질문으로 실제 답변까지 받는다
await shot("screen-chat", "/", async () => {
  // 픽스처 계정엔 지난 대화가 남아 있다 — 새 대화로 시작해 이전 답변이 화면에 섞이지 않게 한다.
  // 새 대화는 **API로** 만든다. UI 버튼 찾기는 두 번 빗나갔다(2026-07-30 실측):
  //   ⓐ 이름 /새 대화/ → 같은 제목의 지난 대화·'대화 삭제: 새 대화' 버튼에 걸림
  //   ⓑ 클래스 ChatApp_newBtn → 사이드바 변형에서 비가시(클릭 타임아웃)
  // 목록은 최신순이라 갓 만든 대화가 첫 항목이다.
  await ctx.request.post(`${BASE}/api/app/chats`, { data: {} });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await settle();
  // ⓒ 사이드바 항목 클릭도 비가시로 실패했다 → 클릭을 아예 쓰지 않는다. 갓 만든 대화가
  //   updated_at 최신이라 앱이 로드 시 그것을 자동 선택한다(아래 빈-대화 단정으로 보증).
  // 빈 대화인지 확인 — 이력이 남아 있으면 히어로에 지난 문답이 섞인다
  const pre = await answerCount();
  if (pre !== 0) throw new Error(`⛔ 새 대화가 비어있지 않다(답변 ${pre}개) — 목록 정렬 확인 필요`);
  const box = page.getByPlaceholder(/물어보세요/);
  await box.fill(SAFE_Q);
  // ⛔ Enter로 보내지 말 것 — Playwright의 fill+Enter는 컴포저의 IME 이중전송 가드
  //   (ChatApp.tsx:570)를 우회해 같은 질문이 두 번 전송된다(2026-07-30 실측: 답변 2개).
  await page.getByRole("button", { name: "보내기" }).click();
  // ⛔ '근거 N개' 버튼을 완료 신호로 쓰지 말 것 — 스트리밍 **중**에 이미 렌더된다
  //   ("근거를 찾았어요 — 답변 작성 중…" 상태로 찍혔다, 2026-07-30 실측).
  //   전송 버튼의 aria-label 전환(답변 생성 중 → 보내기)이 유일하게 정확한 완료 신호다.
  const busy = page.getByRole("button", { name: "답변 생성 중" });
  await busy.waitFor({ timeout: 30_000 }).catch(() => {});
  await busy.waitFor({ state: "detached", timeout: 240_000 });
  await page.waitForTimeout(1500);
  // 질문이 두 번 전송되면 히어로 이미지에 중복 말풍선 + '검색 중…'이 찍힌다(2026-07-30 실측).
  // ⚠ 질문 문자열을 세면 안 된다 — 사이드바 대화 제목도 같은 문장이라 늘 과다 계수된다(3개로 오판).
  //   답변 블록(근거 배지)의 수가 정확한 신호다.
  const answers = await answerCount();
  if (answers !== 1) throw new Error(`⛔ 답변 ${answers}개 — 1개여야 한다(이중 전송)`);
  // 근거에 비공개 층이 섞였는지 화면 텍스트로 최종 확인 — 섞이면 실패시켜 커밋을 막는다.
  // ⚠ innerText(렌더된 것)로 본다. textContent는 <script>의 __NEXT_DATA__까지 읽어
  //   보이지도 않는 문서목록 JSON에 걸려 오탐한다(2026-07-30 실측).
  const body = await page.locator("body").innerText();
  for (const bad of ["ERP 상세가이드", "ERP 시스템", "상세가이드 ·", "대외업무"]) {
    if (body.includes(bad)) throw new Error(`⛔ 비공개 층 노출('${bad}') — 질문을 바꾸고 x_sources를 재확인하라`);
  }
});

// ② 규정 찾기 · ③ 업무 도구 허브 · ④ 결재선(위임전결규정 별표 = ALIO 공개분)
await shot("screen-browse", "/browse");
await shot("screen-tools", "/now");
await shot("screen-approval", "/approval");

await browser.close();
console.log(`\n✅ README 이미지 → ${OUT}/`);
