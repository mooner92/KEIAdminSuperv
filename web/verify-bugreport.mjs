// docs/32 §7 수용 기준 실렌더 검증 — 🐛 버그리포트 탭(카드·버전 배지·접기·flag 게이트).
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
import { makeCheck } from "./verify-lib.mjs";
const { check, finish } = makeCheck();

const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.request.post(BASE + "/api/app/auth/login", { data: { username: TEST_USER, password: TEST_PW } });
// ⚠ 토글은 같은 오리진 프록시로 — 9001 직접 호출은 로그인 쿠키(3101 오리진)가 안 붙어 무권한
const setFlag = (enabled) =>
  ctx.request.post(BASE + "/api/app/flags/bug_reports", { data: { enabled } });

await setFlag(true);
const p = await ctx.newPage();
await p.goto(BASE + "/changelog/", { waitUntil: "load" });
await p.waitForTimeout(1200);

// ① 탭 노출 + 진입
const tab = p.locator('button[role="tab"]', { hasText: "버그리포트" });
check("① 🐛 버그리포트 탭 노출", (await tab.count()) === 1);
await tab.click();
await p.waitForTimeout(300);

// ② 카드 목록 — 최신·심각도 순(개수는 노트 수만큼, 하드코딩 금지 — 드리프트 방지)
const cards = p.locator("details");
const n = await cards.count();
check("② 버그리포트 카드 노출(≥6)", n >= 6, `${n}건`);
const firstText = await cards.first().innerText();
// ⚠ '첫 카드는 높음'은 데이터에 달린 단언이라 새 리포트가 쌓이면 깨진다(2026-08-03 실측 실패).
//    검증할 것은 값이 아니라 **정렬 규칙**이다 — 날짜 내림차순, 같은 날짜면 심각도 순.
const order = { "높음": 0, "보통": 1, "낮음": 2 };
const rows = await cards.evaluateAll((els) => els.map((e) => {
  const t = e.innerText;
  return { sev: (t.match(/🐛\s*(높음|보통|낮음)/) || [])[1] || "",
           date: (t.match(/(\d{4}\.\d{2}\.\d{2})/) || [])[1] || "" };
}));
const sortedOk = rows.every((r, i) => i === 0 || rows[i - 1].date > r.date ||
  (rows[i - 1].date === r.date && (order[rows[i - 1].sev] ?? 9) <= (order[r.sev] ?? 9)));
check("② 정렬 규칙 — 최신 날짜 우선, 같은 날짜면 심각도 순", sortedOk,
      rows.slice(0, 3).map((r) => `${r.date}/${r.sev}`).join(" "));

// ③ 배지: 버전·영역·날짜
check("③ 버전 배지 vYYYY.MM.DD", /v\d{4}\.\d{2}\.\d{2}/.test(firstText));
check("③ 영역 칩", /서식 다운로드|검색 품질|답변 품질|화면/.test(firstText));

// ④ 펼치면 증상→원인→해결→개선 효과 섹션 렌더
await cards.first().locator("summary").click();
await p.waitForTimeout(300);
const opened = await cards.first().innerText();
const secs = ["증상", "원인", "해결", "개선 효과"];
check("④ 상세 섹션 4종 렌더", secs.every((s) => opened.includes(s)), secs.filter((s) => !opened.includes(s)).join(","));
await p.screenshot({ path: "verify-bugreport-open.png", fullPage: false });

// ⑤ 기존 탭 오염 없음 — '전체'에는 버그리포트 카드 미출현
await p.locator('button[role="tab"]', { hasText: "전체" }).click();
await p.waitForTimeout(300);
const allText = await p.innerText("body");
check("⑤ '전체' 탭에 버그리포트 본문 미혼입", !allText.includes("## 증상") && !allText.includes("재정렬 단계가 단어만"));

// ⑥ flag off → 탭 미노출. ⚠ 토글로 검증하지 않는다 — 플래그 변경은 관리자 전용이라
//    픽스처 계정에선 403이 조용히 무시되고, 그 결과가 '기능 결함'으로 오독된다(2026-08-03 실측).
//    응답을 가로채면 권한 없이도 off 상태를 만들 수 있고 남의 dev 설정도 안 바뀐다.
const p2 = await ctx.newPage();
await p2.route("**/app/flags", async (route) => {
  const res = await route.fetch();
  route.fulfill({ response: res, json: { ...(await res.json()), bug_reports: false } });
});
await p2.goto(BASE + "/changelog/", { waitUntil: "load" });
await p2.waitForTimeout(1500);
check("⑥ flag off 시 탭 미노출",
      (await p2.locator('button[role="tab"]', { hasText: "버그리포트" }).count()) === 0);

await b.close();
process.exit(finish());
