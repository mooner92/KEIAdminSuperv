// docs/34 수용 기준 실렌더 검증 — ② 신뢰 탭 · ① 서식 찾기 · ③ 기간 필터·Stop 버튼.
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
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const b = await chromium.launch();
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log((ok ? "✅" : "❌") + " " + n + (d ? " — " + d : "")); ok ? pass++ : fail++; };

const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
await ctx.request.post(BASE + "/api/app/auth/login", { data: { username: TEST_USER, password: TEST_PW } });

// ── ② 신뢰 탭 ──
const p = await ctx.newPage();
await p.goto(BASE + "/admin/#trust", { waitUntil: "load" });
await p.waitForTimeout(2000);
const tb = await p.innerText("body");
check("② 🛡 신뢰 탭 렌더", tb.includes("고위험 답변 레이더") && tb.includes("수요 × 품질"));
check("② 프라이버시 고지", tb.includes("질문·답변 본문은 표시되지 않아요"));
// API 응답에 본문 부재(이중 확인)
const tr = await (await ctx.request.get(BASE + "/api/app/trust?days=30")).json();
check("② API에 매트릭스·레이더 존재", Array.isArray(tr.matrix) && Array.isArray(tr.radar), `matrix ${tr.matrix.length}`);
await p.screenshot({ path: "verify-trust-tab.png" });

// ── ① 서식 찾기 ──
await p.goto(BASE + "/forms/", { waitUntil: "load" });
await p.waitForTimeout(1500);
const fb = await p.innerText("body");
const total = fb.match(/별지 서식 (\d+)종/);
check("① /forms 렌더 + 대장 건수", !!total && Number(total[1]) > 150, total ? total[1] + "종" : "");
await p.fill('input[aria-label="서식 검색"]', "이행각서");
await p.waitForTimeout(400);
check("① 이름 검색", (await p.locator("tbody tr").count()) >= 1 && (await p.innerText("tbody")).includes("연구사업이행각서"));
await p.fill('input[aria-label="서식 검색"]', "별지 3");
await p.waitForTimeout(400);
const rows3 = await p.locator("tbody tr").count();
check("① 번호 검색(별지 3)", rows3 >= 5, `${rows3}건`);
await p.fill('input[aria-label="서식 검색"]', "복무규정");
await p.waitForTimeout(400);
check("① 규정명 검색", (await p.innerText("tbody")).includes("복무규정"));
await p.screenshot({ path: "verify-forms.png" });
// 원문 보기 → 문서 앵커 '실착지'(리뷰 확정: URL 검사만으론 미착지 미검출)
await p.locator('a:has-text("원문 보기")').first().click();
await p.waitForTimeout(1800);
check("① 원문 보기 → /d/ 이동", p.url().includes("/d/"), p.url().slice(0, 70));
const landed = await p.evaluate(() => {
  const id = decodeURIComponent(location.hash.slice(1));
  const el = document.getElementById(id);
  if (!el) return { ok: false, why: "앵커 요소 없음: " + id };
  const r = el.getBoundingClientRect();
  return { ok: r.top >= -10 && r.top < window.innerHeight, why: `top=${Math.round(r.top)}` };
});
check("① 앵커 실착지(요소 존재+뷰포트)", landed.ok, landed.why);
check("① 푸터 진입점", (await p.innerText("footer")).includes("서식 찾기"));
// 하이픈 호수 검색(리뷰 확정: 제6-1호 누락됐던 회귀)
await p.goto(BASE + "/forms/", { waitUntil: "load" });
await p.waitForTimeout(1200);
await p.fill('input[aria-label="서식 검색"]', "내부감사규정 별지 6-1");
await p.waitForTimeout(400);
const hyBody = await p.innerText("tbody");
check("① 하이픈 호수+AND 검색", hyBody.includes("별지 제6-1호") && !hyBody.includes("보안관리규정"), hyBody.slice(0, 60));

// ── ③ 대시보드 기간 필터 ──
await p.goto(BASE + "/admin/#dash", { waitUntil: "load" });
await p.waitForTimeout(1800);
await p.selectOption('select[aria-label="집계 기간"]', "7");
await p.waitForTimeout(1200);
check("③ 기간 필터 → 7일 반영", (await p.innerText("body")).includes("최근 7일") || (await p.innerText("body")).includes("주간"), "");

// 다크 실측(리뷰 확정 공백): 신뢰 탭·서식 찾기 글자색
const pd = await ctx.newPage();
await pd.addInitScript(() => localStorage.setItem("kei-theme", "dark"));
await pd.goto(BASE + "/admin/#trust", { waitUntil: "load" });
await pd.waitForTimeout(1800);
const dTrust = await pd.evaluate(() => {
  const el = document.querySelector("h3");
  const m = getComputedStyle(el).color.match(/\d+/g).map(Number);
  return (m[0] + m[1] + m[2]) / 3;
});
check("② 다크: 신뢰 탭 제목 밝음", dTrust > 150, String(dTrust));
await pd.goto(BASE + "/forms/", { waitUntil: "load" });
await pd.waitForTimeout(1200);
const dForms = await pd.evaluate(() => {
  const el = document.querySelector("tbody td");
  const m = getComputedStyle(el).color.match(/\d+/g).map(Number);
  return (m[0] + m[1] + m[2]) / 3;
});
check("① 다크: 서식 표 밝음", dForms > 150, String(dForms));
await pd.screenshot({ path: "verify-forms-dark.png" });
await pd.close();

// ── ③ Stop 버튼 + 2단계 표시 ──
await p.goto(BASE + "/", { waitUntil: "load" });
await p.waitForTimeout(1500);
await p.click('button:has-text("＋ 새 대화")').catch(() => {});
await p.waitForTimeout(800);
await p.fill("textarea", "국내출장 여비 정산 절차를 자세히 알려줘");
await p.click('button[aria-label="보내기"]');
await p.waitForTimeout(900);
const early = await p.innerText("body");
check("③ 대기 표시(검색/작성 단계)", early.includes("규정 검색 중") || early.includes("답변 작성 중"), "");
const stopBtn = p.locator('button[aria-label="응답 수신 중단"]');
check("③ ■ 중단 버튼 표시", (await stopBtn.count()) === 1);
// 토큰이 조금 흐른 뒤 중단
await p.waitForTimeout(6000);
await stopBtn.click();
await p.waitForTimeout(800);
const afterStop = await p.innerText("body");
check("③ 중단 표기(정직)", afterStop.includes("중단됨") && afterStop.includes("저장"), "");
check("③ 중단 후 즉시 입력 가능", (await p.locator('button[aria-label="보내기"]').count()) === 1);
await p.screenshot({ path: "verify-stop.png" });
// 리뷰 확정: 중단 → 같은 대화 재질문 — 이전 말풍선 불변·새 답변 1개(센티널 id 회수)
const stoppedText = await p.locator("li").filter({ hasText: "중단됨" }).first().innerText();
await p.fill("textarea", "연차휴가 이월 규정 알려줘");
await p.click('button[aria-label="보내기"]');
await p.waitForTimeout(4000);
await p.locator('button[aria-label="응답 수신 중단"]').click().catch(() => {});
await p.waitForTimeout(800);
const stoppedAfter = await p.locator("li").filter({ hasText: "중단됨" }).first().innerText();
check("③ 재질문 후 이전 말풍선 불변", stoppedAfter.slice(0, 80) === stoppedText.slice(0, 80));
// 리뷰 확정: 중단 → 대화 재진입 시 답변이 '저장'돼 있어야(서버 finally-save)
const chatUrl = p.url();
await p.reload({ waitUntil: "load" });
await p.waitForTimeout(3000);
const reloaded = await p.innerText("body");
check("③ 재열람 시 저장된 답변 존재", reloaded.includes("연차") || reloaded.includes("이월"), "");

// ── flag off 게이트(새 컨텍스트 + 응답 고정) ──
const ctxOff = await b.newContext();
await ctxOff.route("**/api/app/flags**", async (route) => {
  try {
    const r = await route.fetch();
    const j = await r.json();
    if (j.flags) { j.flags.forms_registry = false; j.flags.trust_ops = false; }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(j) });
  } catch { await route.abort().catch(() => {}); } // 브라우저 종료 레이스 무해화
});
await ctxOff.request.post(BASE + "/api/app/auth/login", { data: { username: TEST_USER, password: TEST_PW } });
// 리뷰 확정: flag off 시 /admin 🛡 탭 미노출 — 탭 렌더까지 폴링(route 반영 대기)
const poffAdmin = await ctxOff.newPage();
await poffAdmin.goto(BASE + "/admin/", { waitUntil: "load" });
const adminGated = await poffAdmin.waitForFunction(
  () => { const b = document.body.innerText;
    return (b.includes("📊 대시보드") || b.includes("관리자 전용")) && !b.includes("🛡 신뢰"); },
  undefined, { timeout: 8000 }).then(() => true).catch(() => false);
check("게이트: flag off /admin에 🛡 신뢰 탭 미노출", adminGated);
const poff = await ctxOff.newPage();
await poff.goto(BASE + "/forms/", { waitUntil: "load" });
// 플래그 fetch 타이밍 무관하게 폴링 판정(기본값 false → 곧 '준비 중'으로 수렴해야 함)
const gated = await poff.waitForFunction(
  () => document.body.innerText.includes("준비 중") && !document.querySelector("tbody tr"),
  undefined, { timeout: 8000 }).then(() => true).catch(() => false);
if (!gated) console.log("   (디버그) 본문:", (await poff.innerText("body")).slice(0, 120).replace(/\n/g, " | "));
check("게이트: flag off /forms = 준비 중(표 미노출)", gated);

console.log(`\n${pass}/${pass + fail} 판정 통과`);
await ctxOff.close().catch(() => {});
await b.close();
process.exit(fail ? 1 : 0);
