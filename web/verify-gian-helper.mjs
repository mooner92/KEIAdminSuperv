// 기안 도우미(/gian, docs/72 P4) 실렌더 검증 — 5개 항목과 **근거**가 실제로 그려지는지.
// 2026-08-20 화면 개편(요약 카드 + 접기) 반영: 조문 원문·체크리스트 전문·편철 원칙은
// `<details>`(components/gian/Fold)로 내려갔다. ⛔검증 항목은 하나도 줄이지 않는다 —
// 접힌 것은 **펼쳐서** 그대로 확인하고(정보 삭제가 아님을 이 회귀가 증명한다),
// "기본은 접혀 있다"·"요약 카드가 있다"는 검증을 오히려 **추가**했다.
// ⛔ 비밀번호는 env로만: set -a; . tools/.test_credentials; set +a; node web/verify-gian-helper.mjs
// 플래그(gian_helper)는 검증 중에만 켜고 **원래 값으로 되돌린다**(dev DB 부수효과 없음).
// ⚠ 파일명이 verify-gian.mjs가 아닌 이유: 그 이름은 이미 '기안 노트 적재·크로스링크' 검증이
//   쓰고 있다(커밋 1efd3df). 덮어쓰면 기존 회귀가 사라지므로 별도 파일로 둔다.
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
const FLAG = "gian_helper";

const sql = (q) =>
  execFileSync("python3", ["-c",
    `import sqlite3,sys;c=sqlite3.connect(${JSON.stringify(DB)});r=c.execute(${JSON.stringify(q)}).fetchall();c.commit();print(r)`,
  ], { encoding: "utf-8" }).trim();

const before = sql(`select enabled from flag where key='${FLAG}'`);
const had = /\d/.test(before);
const prev = had ? before.includes("1") : null;
sql(had ? `update flag set enabled=1 where key='${FLAG}'`
        : `insert into flag(key,enabled,updated_by,updated_at) values('${FLAG}',1,'verify-gian',0)`);
console.log(`플래그 ${FLAG}: 이전=${had ? prev : "(없음)"} → 검증용 ON`);

const b = await chromium.launch();
const fails = [];
const ok = (c, m) => { console.log((c ? "✅" : "❌") + " " + m); if (!c) fails.push(m); };
/** 접기(Fold) 전부 펼치기 — 접힌 근거도 **삭제되지 않았음**을 같은 문자열로 확인하기 위해. */
const expandAll = async (p) => {
  await p.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
  await p.waitForTimeout(250);
};

try {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1200 } });
  await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: TEST_USER, password: TEST_PW } });
  const flags = await (await ctx.request.get(`${BASE}/api/app/flags`)).json();
  ok((flags.flags || flags)[FLAG] === true, `0) /app/flags에 ${FLAG}=true`);

  const p = await ctx.newPage();
  await p.goto(`${BASE}/gian/`, { waitUntil: "load" });
  await p.waitForTimeout(1800);
  // 기본 선택을 결정적으로 만든다(localStorage 잔여값 무시) — 첫 업무군 = 출장
  await p.getByRole("button", { name: "출장", exact: true }).click();
  await p.waitForTimeout(400);
  let body = await p.innerText("body");
  ok(!body.includes("아직 준비 중"), "1) 플래그 ON — 화면 노출(준비 중 문구 없음)");
  ok(!body.includes("기안 안내표를 읽지 못했습니다"), "2) gian_map.json 로드 성공(빈 상태 아님)");

  // ── 개편 계약: 첫 화면은 "핵심만", 원문은 접혀 있다(2026-08-20 운영자 지적) ──
  const foldCount = await p.locator("details").count();
  ok(foldCount >= 4, `A) 접기(Fold) ${foldCount}개 — 원문·전문은 접어서 내렸다`);
  ok(await p.locator("details[open]").count() === 0, "B) 기본 상태에서 모든 접기가 닫혀 있다");
  ok(!body.includes("결재는 결재권자가 소정의 결재란에"),
    "C) 첫 화면에 조문 원문이 박혀 있지 않다(접기 안으로 이동)");
  ok(!body.includes("잘못 편철하면 전자기록물 검색"),
    "D) 첫 화면에 편철 원칙 전문이 나열되지 않는다");
  // 요약 카드 4장 = 위계의 시작(무엇을 몇 건 봐야 하는지)
  for (const [label, n] of [["문서종류", 7], ["첨부", 5], ["기록물철", 2], ["전결 규칙", 11]]) {
    ok(await p.getByRole("button", { name: new RegExp(`^${label} ${n}`) }).count() > 0,
      `E) 요약 카드 '${label} ${n}'`);
  }
  ok(body.includes("권장") && body.includes("후보"), "F) 요약 카드에 단정 금지 라벨(권장·후보) 유지");
  // 카드 → 섹션 이동
  await p.getByRole("button", { name: /^기록물철 2/ }).click();
  await p.waitForTimeout(600);
  ok(await p.locator("#gian-file").count() > 0, "G) 요약 카드가 가리키는 섹션 앵커(#gian-file) 존재");

  // 접힌 근거를 전부 펼쳐서 — 아래 기존 검증 항목은 하나도 줄이지 않는다
  await expandAll(p);
  body = await p.innerText("body");

  // ⓐ 어떤 문서로 기안하나
  ok(body.includes("국내출장신청") && body.includes("해외출장결과보고"), "3) ⓐ 문서종류(국내출장신청·해외출장결과보고)");
  ok(body.includes("문서관리규정 제22조") && body.includes("별지 제1호 서식"),
    "4) ⓐ 기안 근거 조문(문서관리규정 제22조 + 별지 서식) 원문 표시");

  // ⓑ 첨부(권장) — 단정 금지 라벨
  ok(body.includes("출장계획 자료") && body.includes("영수증 및 예약내역"), "5) ⓑ 첨부 항목 렌더");
  ok(body.includes("권장"), "6) ⓑ '권장' 라벨(규정 근거 아님을 명시)");
  ok(body.includes("첨부 확인 체크리스트"), "7) ⓑ 첨부 확인 체크리스트");

  // ⓒ 기록물철 후보 — 코드·보존기간·근거 문장
  ok(body.includes("ZA000102") && body.includes("(공통)출장"), "8) ⓒ 기록물철 후보 코드·철명");
  ok(body.includes("보존기간 5년"), "9) ⓒ 보존기간(코드표 원문)");
  ok(body.includes("편철은 출장/대외활동 관련 기록물철 우선 검토"), "10) ⓒ 후보를 낳은 근거 문장 노출");
  ok(body.includes("기록물관리규정 제14조") || body.includes("기록물관리규정 제11조"), "11) ⓒ 편철 규정 근거 조문");

  // ⓓ 결재선 역할 — 협조냐 결재냐 + 근거 없는 역할은 없다고 말하기
  for (const r of ["결재", "전결", "대결", "협조(순차)", "협조(병렬)", "참조", "후열"]) {
    ok(body.includes(r), `12) ⓓ 결재선 역할 '${r}'`);
  }
  ok(body.includes("문서관리규정 제29조"), "13) ⓓ 전결 역할에 규정 조문 근거(제29조)");
  ok(body.includes("규정 조문에서 확인하지 못했습니다"), "14) ⓓ 근거 없는 역할(참조·후열)은 없다고 표시");
  ok(body.includes("100만원 초과 지출"), "15) ⓓ 일상감사 기준(화면 안내문 원문)");

  // ⓔ 전결권자
  ok(body.includes("전결권자") && body.includes("위임전결규정 별표"), "16) ⓔ 전결 규칙 + 별표 원문행 근거");
  ok(/가\.출장/.test(body), "17) ⓔ 위임전결 '가.출장' 규칙 조인");
  ok(body.includes("결재올림 전 최종 확인"), "18) 결재올림 전 체크리스트");
  ok(body.includes("첨부서류는 '권장'") && body.includes("기록물철은 '후보'"), "19) 면책 — 단정 금지 명시");
  await p.screenshot({ path: "/tmp/verify-gian-travel.png", fullPage: true });

  // 업무군 전환 — 회계·예산·구매·자산
  await p.getByRole("button", { name: "회계·예산·구매·자산" }).click();
  await p.waitForTimeout(500);
  await expandAll(p);
  body = await p.innerText("body");
  ok(body.includes("원인행위품의") && body.includes("세금계산서"), "20) 업무군 전환 — 문서종류·첨부 갱신");
  ok(body.includes("ZA000110") && body.includes("(공통)예산및회계"), "21) 업무군 전환 — 기록물철 후보 갱신");
  ok(body.includes("ZA000107") && body.includes("코드표 고르는 요령"),
    "22) 코드표 '고르는 요령'에서 온 후보(물품 구매 → ZA000107) + 근거종류 라벨");
  ok(body.includes("3.예산집행"), "23) 업무군 전환 — 전결 규칙 갱신(일치 낱말 많은 규칙 먼저)");
  ok(/일치 낱말:[^\n]*예산/.test(body), "24) 왜 걸렸는지(일치 낱말) 노출");
  await p.screenshot({ path: "/tmp/verify-gian-accounting.png", fullPage: true });

  // 직급 필터 — 위임전결 leaf가 직급인 업무군(출장)에서만 나타난다
  await p.getByRole("button", { name: "출장", exact: true }).click();
  await p.waitForTimeout(500);
  const sel = p.locator('select[aria-label="직급 필터"]');
  ok(await sel.count() > 0, "25) 전결 목록 직급 필터 존재(출장 — leaf가 직급)");
  await sel.selectOption({ label: "일반직원" });
  await p.waitForTimeout(400);
  await expandAll(p);
  body = await p.innerText("body");
  ok(body.includes("일반직원") && !body.includes("· 부원장"), "26) 직급 필터 적용(일반직원만)");
  // 금액구간 leaf(회계)에는 직급 필터가 없어야 한다 — 빈 항목만 든 셀렉트 금지
  await p.getByRole("button", { name: "회계·예산·구매·자산" }).click();
  await p.waitForTimeout(500);
  ok(await p.locator('select[aria-label="직급 필터"]').count() === 0,
    "27) 대상이 직급이 아닌 업무군에선 직급 필터 숨김");

  // 진입점 — 업무 도구 허브 카드
  await p.goto(`${BASE}/now/`, { waitUntil: "load" });
  await p.waitForTimeout(1200);
  ok((await p.innerText("body")).includes("기안 도우미"), "28) /now 허브에 '기안 도우미' 카드");
} finally {
  if (had) sql(`update flag set enabled=${prev ? 1 : 0} where key='${FLAG}'`);
  else sql(`delete from flag where key='${FLAG}'`);
  console.log(`복구: ${FLAG}=${had ? prev : "(행 삭제)"}`);
  await b.close();
}

console.log(fails.length ? `\n❌ ${fails.join(" / ")}` : "\n✅ 기안 도우미 실렌더 검증 통과");
process.exit(fails.length ? 1 : 0);
