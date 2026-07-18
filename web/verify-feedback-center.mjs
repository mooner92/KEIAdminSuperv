// docs/51 §8 수용 기준 실렌더 검증 — 의견 보내기(폼·프리필·내역·진입점·관리자 의견함·flag off·RL).
// (verify-feedback.mjs는 답변 👍/👎용 — 별개 스위트)
import { chromium } from "playwright";
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const b = await chromium.launch();
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log((ok ? "✅" : "❌") + " " + n + (d ? " — " + d : "")); ok ? pass++ : fail++; };

// 관리자 컨텍스트(플래그 토글·의견함) + 일반 사용자 컨텍스트(제출·RL — fb_test)
const adm = await b.newContext({ viewport: { width: 1280, height: 950 } });
await adm.request.post(BASE + "/api/app/auth/login", { data: { username: "admintest", password: "admtest123" } });
const setFlag = (enabled) =>
  adm.request.post(BASE + "/api/app/flags/feedback_center", { data: { enabled } });
await setFlag(true);

const usr = await b.newContext({ viewport: { width: 1280, height: 950 } });
await usr.request.post(BASE + "/api/app/auth/login", { data: { username: "fb_test", password: "test1234" } });

// ① 폼 렌더 + 제출 + 내 제보 반영
const p = await usr.newPage();
await p.goto(BASE + "/feedback/", { waitUntil: "load" });
await p.waitForTimeout(1200);
check("① 유형 칩 5종", (await p.locator('[role="radio"]').count()) === 5);
await p.locator('[role="radio"]', { hasText: "누락신고" }).click();
await p.fill('input[placeholder*="여비규정"]', "복무규정");
await p.fill("textarea", "검증용 제보 — 우리 부서 개정본이 아직 안 보입니다 (verify-feedback)");
await p.locator("button", { hasText: "보내기" }).click();
await p.waitForTimeout(800);
check("① 제출 성공 안내", (await p.innerText("body")).includes("접수됐어요"));
// 목록 갱신은 비동기 — 새 제보 카드가 뜰 때까지 명시적 대기(레이스 방지)
const newCard = p.locator("article").filter({ hasText: "verify-feedback" }).first();
await newCard.waitFor({ timeout: 6000 }).catch(() => {});
check("① 내 제보 목록 반영", (await newCard.count()) >= 1 && (await newCard.innerText()).includes("복무규정"));
check("① 상태 배지(접수)", (await newCard.innerText().catch(() => "")).includes("접수"));
await p.screenshot({ path: "verify-feedback-form.png" });

// ② 프리필
await p.goto(BASE + "/feedback/?doc=" + encodeURIComponent("여비규정") + "&anchor=" + encodeURIComponent("제12조") + "&type=" + encodeURIComponent("오류신고"), { waitUntil: "load" });
await p.waitForTimeout(900);
check("② 프리필 doc", await p.inputValue('input[placeholder*="여비규정"]') === "여비규정");
check("② 프리필 anchor", await p.inputValue('input[placeholder*="제12조"]') === "제12조");
check("② 프리필 type", await p.locator('[role="radio"][aria-checked="true"]').innerText() === "오류신고");

// ③ 진입점: 푸터 · /now 카드 · 문서 드로어 의견 버튼
await p.goto(BASE + "/browse/", { waitUntil: "load" });
await p.waitForTimeout(1200);
check("③ 푸터 '의견 보내기' 링크", (await p.locator('footer a[href="/feedback/"]').count()) === 1);
await p.goto(BASE + "/now/", { waitUntil: "load" });
await p.waitForTimeout(1000);
check("③ 허브 카드", (await p.locator('a[href="/feedback/"]', { hasText: "의견 보내기" }).count()) >= 1);
await p.goto(BASE + "/browse/", { waitUntil: "load" });
await p.waitForTimeout(1200);
await p.locator("main li button").first().click(); // 문서 행(정렬 헤더 아님) → 드로어 열림
await p.waitForTimeout(1500);
const fbBtn = p.locator('a[href^="/feedback/?type="]');
check("③ 드로어 📮 의견 버튼(프리필 링크)", (await fbBtn.count()) >= 1,
  (await fbBtn.count()) ? await fbBtn.first().getAttribute("href") : "없음");

// ④ 관리자 의견함: 접수 항목 · 상태 변경 · 메모 → 사용자에게 보임
const a = await adm.newPage();
await a.goto(BASE + "/admin/#reports", { waitUntil: "load" });
await a.waitForTimeout(1500);
const admBody = await a.innerText("body");
check("④ 의견함 탭·접수함 렌더", admBody.includes("접수함") && admBody.includes("유지보수 알림"));
check("④ 검증용 제보 노출", admBody.includes("verify-feedback"));
const card = a.locator("article").filter({ hasText: "verify-feedback" }).first();
await card.locator("select").selectOption("처리완료");
await a.waitForTimeout(600);
await card.locator('input[placeholder*="처리 메모"]').fill("개정본 확보 후 반영 완료(검증)");
await card.locator("button", { hasText: "저장" }).click();
await a.waitForTimeout(600);
// ⚠ admin_note는 input value라 innerText에 안 잡힘 — 저장 후 리로드된 input 값으로 단언
const savedCard = a.locator("article").filter({ hasText: "verify-feedback" }).first();
const savedNote = await savedCard.locator('input[placeholder*="처리 메모"]').inputValue();
const savedState = await savedCard.locator("select").inputValue();
check("④ 상태 변경+메모 저장", savedState === "처리완료" && savedNote.includes("반영 완료(검증)"));
// ④-2 메모가 DB에 영속되는지 — 재조회(API)로 확인(리로드해도 남아야 함)
const persisted = await adm.request.get(BASE + "/api/app/reports/all").then((r) => r.json());
const dbRow = persisted.find((x) => x.내용 && x.내용.includes("verify-feedback"));
check("④-2 메모 DB 영속(API 재조회)", !!dbRow && dbRow.admin_note.includes("반영 완료(검증)") && dbRow.상태 === "처리완료");
// ④-3 접수 시각(날짜+시:분) 표시 — 날짜만이 아니라 시각까지
const timeText = await savedCard.locator("time").first().innerText();
check("④-3 접수 일시에 시각(시:분) 표시", /\d{1,2}:\d{2}/.test(timeText), timeText);
await a.screenshot({ path: "verify-feedback-admin.png" });
await p.goto(BASE + "/feedback/", { waitUntil: "load" });
await p.waitForTimeout(1000);
const mineNow = await p.locator("article").filter({ hasText: "verify-feedback" }).first().innerText();
check("④ 사용자 쪽 상태·메모 반영", mineNow.includes("처리 완료") && mineNow.includes("반영 완료(검증)"));

// ⑤ 유지보수 알림·계획안(분석기 산출물) — 계획 존재 여부는 API로 판정(카드의 analysis_group
//    텍스트에 'plan_'이 있어 본문 문자열 검사는 오작동 → 실제 계획 파일 버튼만 본다)
check("⑤ 계획안 섹션 렌더", admBody.includes("최신 유지보수 계획안"));
const planResp = await adm.request.get(BASE + "/api/app/maint/plan/latest");
if (planResp.ok()) {
  const planBtn = a.locator("button").filter({ hasText: /plan_\d{8}_\d{4}\.md/ });
  const hasBtn = (await planBtn.count()) >= 1;
  check("⑤ 계획안 토글 버튼", hasBtn);
  if (hasBtn) {
    await planBtn.first().click();
    await a.waitForTimeout(500);
    // v2 게이트 라벨(G0~G3) 또는 구 라벨 어느 쪽이든 — 보고서 본문이 펼쳐졌는지
    check("⑤ 계획안 md 펼침(게이트/조치 섹션)",
      /운영조치|코드작업|분석·안내|사람 전용|로컬조치/.test(await a.innerText("body")));
  }
} else {
  check("⑤ 계획 없음 안내", admBody.includes("아직 생성된 계획이 없습니다"));
}

// ⑨ 게이트 v2: '지금 분석' 버튼 + API(started) + 최신 보고서에 게이트·확인포인트 섹션
check("⑨ '지금 분석' 버튼", (await a.locator("button", { hasText: "지금 분석" }).count()) === 1);
const az = await adm.request.post(BASE + "/api/app/maint/analyze");
check("⑨ POST /maint/analyze → started", az.ok() && (await az.json()).started === true);
const latestPlan = await adm.request.get(BASE + "/api/app/maint/plan/latest");
if (latestPlan.ok()) {
  const pmd = (await latestPlan.json()).md;
  check("⑨ 보고서: 게이트 라벨(G0~G3)", /G[0-3] /.test(pmd));
  check("⑨ 보고서: 초안·무실행 배너", pmd.includes("자동 실행되지 않았습니다"));
} else {
  check("⑨ 보고서 게이트 형식(계획 없음 — 스킵 불가)", false, "plan 404");
}

// ⑥ 레이트리밋(10/시간/사용자) — API 직접으로 소진 → 429
// ⚠ admintest로 소진: fb_test 한도를 쓰면 같은 시간대 재실행 시 ①(제출)이 429로 깨져
//   스위트가 비반복적이 된다(실측). admintest는 본 스위트에서 제보 제출이 없어 안전.
let rlHit = false;
for (let i = 0; i < 12; i++) {
  const r = await adm.request.post(BASE + "/api/app/reports", {
    data: { 유형: "기타", 내용: `RL 검증용 더미 제보 ${i} — 무시하세요` } });
  if (r.status() === 429) { rlHit = true; break; }
}
check("⑥ 레이트리밋 429", rlHit);

// ⑦ 비로그인 401
const anon = await b.newContext();
const r401 = await anon.request.post(BASE + "/api/app/reports", { data: { 유형: "기타", 내용: "익명 제보 시도" } });
check("⑦ 비로그인 POST 401", r401.status() === 401);

// ⑧ flag off → 페이지 준비중 + 푸터 링크 미노출 (런타임 fetch라 리로드 반영)
await setFlag(false);
await p.reload({ waitUntil: "load" });
await p.waitForTimeout(1500);
check("⑧ off: 준비 중 안내", (await p.innerText("body")).includes("준비 중"));
await p.goto(BASE + "/browse/", { waitUntil: "load" });
await p.waitForTimeout(1500);
check("⑧ off: 푸터 링크 미노출", (await p.locator('footer a[href="/feedback/"]').count()) === 0);
await setFlag(true); // 복원

// 🧹 자체 정리: 이 스위트가 만든 테스트 제보(RL 더미·검증용)를 '보류'로 마감 — 접수함에 남아
// 매시간 분석기(LLM)를 소모하는 실측 사고 방지(2026-07-18: 더미 9건이 밤새 재분석 루프).
const allR = await adm.request.get(BASE + "/api/app/reports/all").then((r) => r.json()).catch(() => []);
let cleaned = 0;
for (const r of allR) {
  if (/RL 검증용 더미|\(verify-feedback\)/.test(r.내용 || "") && r.상태 !== "보류") {
    await adm.request.patch(BASE + `/api/app/reports/${r.id}`, {
      data: { 상태: "보류", admin_note: "[자동] verify 스위트 테스트 더미 — 무시" } }).catch(() => {});
    cleaned++;
  }
}
console.log(`🧹 테스트 제보 정리: ${cleaned}건 → 보류`);

console.log(`\n${pass}/${pass + fail} 판정 통과`);
await b.close();
process.exit(fail ? 1 : 0);
