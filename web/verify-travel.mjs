// 여비 계산기(/travel, docs/72 P1) 실렌더 검증 — 값과 **근거**가 실제로 그려지는지.
// ⛔ 비밀번호는 env로만: set -a; . tools/.test_credentials; set +a; node web/verify-travel.mjs
// 플래그(travel_calc)는 검증 중에만 켜고 **원래 값으로 되돌린다**(dev DB 부수효과 없음).
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const TEST_USER = process.env.APP_TEST_USER || "b6test";
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — 검증 계정 비밀번호는 환경변수로만 받습니다.");
  process.exit(2);
}
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const DB = process.env.APP_DB || "/home/mhchoi/kei-dev-0703/tools/app.db";
const FLAG = "travel_calc";

// 관리자 계정 비밀번호가 없는 환경(b6test 픽스처)에서도 플래그를 켤 수 있게 dev DB를 직접 토글.
// (운영 DB 아님 — APP_DB 경로로만 동작하고 끝나면 원상복구)
const sql = (q) =>
  execFileSync("python3", ["-c",
    `import sqlite3,sys;c=sqlite3.connect(${JSON.stringify(DB)});r=c.execute(${JSON.stringify(q)}).fetchall();c.commit();print(r)`,
  ], { encoding: "utf-8" }).trim();

const before = sql(`select enabled from flag where key='${FLAG}'`);
const had = /\d/.test(before);
const prev = had ? before.includes("1") : null;
sql(had ? `update flag set enabled=1 where key='${FLAG}'`
        : `insert into flag(key,enabled,updated_by,updated_at) values('${FLAG}',1,'verify-travel',0)`);
console.log(`플래그 ${FLAG}: 이전=${had ? prev : "(없음)"} → 검증용 ON`);

const b = await chromium.launch();
const fails = [];
const ok = (c, m) => { console.log((c ? "✅" : "❌") + " " + m); if (!c) fails.push(m); };

try {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 } });
  await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: TEST_USER, password: TEST_PW } });
  const flags = await (await ctx.request.get(`${BASE}/api/app/flags`)).json();
  ok((flags.flags || flags)[FLAG] === true, `0) /app/flags에 ${FLAG}=true`);

  const p = await ctx.newPage();
  await p.goto(`${BASE}/travel/`, { waitUntil: "load" });
  await p.waitForTimeout(1800);
  let body = await p.innerText("body");
  ok(!body.includes("아직 준비 중"), "1) 플래그 ON — 화면 노출(준비 중 문구 없음)");

  // 2) 국내(관외) 기본 — 별표 2 정액과 근거 원문행
  ok(body.includes("일비") && body.includes("25,000"), "2) 일비 25,000원(별표 2 원문 값) 렌더");
  ok(body.includes("식비") && body.includes("여비규정 별표 2"), "3) 식비 + 근거 '여비규정 별표 2' 칩");
  ok(body.includes("제5호 내지 제6호") || body.includes("제1호 내지 제4호"), "4) 별표 2 원문행(지급 구분) 표시");
  ok(body.includes("실비"), "5) 운임·숙박은 '실비' 그대로(금액 창작 없음)");
  ok(body.includes("최종 판단은 원문과 담당 부서 확인 바랍니다"), "6) 면책 문구");
  ok(body.includes("별표 1") && /제\d호/.test(body), "7) 직급 근거(별표 1 구분표 원문행)");

  // 8) 일수 3일 → 25,000 × 3 = 75,000, 정액 합계 150,000
  const daysInput = p.locator('input[aria-label="여행일수"]');
  await daysInput.fill("3");
  await p.waitForTimeout(400);
  body = await p.innerText("body");
  ok(body.includes("75,000"), "8) 일비 25,000 × 3일 = 75,000원(일수 곱셈만)");
  ok(body.includes("150,000"), "9) 정액 합계(일비+식비) 150,000원");

  // 10) 숙박 2박 → 제6호 상한 100,000 × 2박
  await p.locator('input[aria-label="숙박 수"]').fill("2");
  await p.waitForTimeout(400);
  body = await p.innerText("body");
  ok(body.includes("200,000") && body.includes("상한"), "10) 숙박비 상한 100,000 × 2박 = 200,000원까지(상한 표기)");
  await p.screenshot({ path: "/tmp/verify-travel-domestic.png", fullPage: true });

  // 11) 근무지 내(제18조) 정액
  await p.getByRole("button", { name: "근무지 내" }).click();
  await p.waitForTimeout(400);
  body = await p.innerText("body");
  ok(body.includes("20,000") && body.includes("제18조"), "11) 근무지 내 4시간 이상 2만원 + 제18조 근거");
  await p.getByRole("button", { name: "4시간 미만" }).click();
  await p.waitForTimeout(300);
  ok((await p.innerText("body")).includes("10,000"), "12) 4시간 미만 1만원");

  // 13) 국외(별표 5) — USD 정액·상한, 지역등급 찾기
  await p.getByRole("button", { name: "국외 출장" }).click();
  await p.waitForTimeout(500);
  body = await p.innerText("body");
  ok(body.includes("미 달러화") || body.includes("$"), "13) 국외 단위 표기(미 달러화)");
  ok(body.includes("$30") || body.includes("$81") || body.includes("$37"), "14) 별표 5 정액(제5·6호) 렌더");
  ok(body.includes("상한액"), "15) 국외 숙박 상한액(원문 그대로)");
  await p.locator('input[aria-label="나라·도시로 지역등급 찾기"]').fill("도쿄");
  await p.waitForTimeout(400);
  ok((await p.innerText("body")).includes("가 등급"), "16) 국가→지역등급 찾기(도쿄 → 가 등급)");
  await p.screenshot({ path: "/tmp/verify-travel-overseas.png", fullPage: true });

  // 17) 감액·특례는 자동 반영 안 함 안내
  ok(body.includes("자동 계산에 넣지 않은") && body.includes("제17조"), "17) 감액·특례 원문 안내(자동 미반영)");
} finally {
  // 원상복구
  if (had) sql(`update flag set enabled=${prev ? 1 : 0} where key='${FLAG}'`);
  else sql(`delete from flag where key='${FLAG}'`);
  console.log(`복구: ${FLAG}=${had ? prev : "(행 삭제)"}`);
  await b.close();
}

console.log(fails.length ? `\n❌ ${fails.join(" / ")}` : "\n✅ 여비 계산기 실렌더 검증 통과");
process.exit(fails.length ? 1 : 0);
