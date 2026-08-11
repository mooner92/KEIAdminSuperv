// 개정 반영 패널(specs/15 §9) 실렌더 검증.
//
// ⛔ 핵심 계약: ⓐ 플래그 off면 안 보인다 ⓑ 개정안은 '승인' 대신 '개정 반영'으로 안내한다
//              ⓒ **잠긴 항목은 감추지 않고 사유를 쓴다**(감추면 사람이 누락으로 오해한다)
//              ⓓ 반영 가능한 항목에만 버튼이 붙는다 ⓔ 반영 후 할 일(01n_approval)을 알려준다
//
// 서버 권한(403·경로 이탈·위조 방어)은 tools/test_amend_api.py가 이미 증명한다.
// 여기서 확인하는 것은 **화면이 서버 판정을 그대로 보여주는가**이다.
// dev 관리자 계정이 없어도 되도록 flags·uploads·amend 응답을 가로채 합성 픽스처로 렌더한다
// (verify-journey-freshness가 플래그 off를 만들 때 쓰는 것과 같은 기법).
//
// 실행: set -a; . tools/.test_credentials; set +a; cd web && node verify-amend-panel.mjs
import { chromium } from "playwright";
import { makeCheck } from "./verify-lib.mjs";

const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) { console.error("❌ APP_TEST_PASS 미설정"); process.exit(2); }
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const USER = process.env.APP_TEST_USER || "b6test";
const { check, finish } = makeCheck();

const UID = "20260804-120000-abc123";
const LOCKED = "별표(표) 내용 — 줄 대조가 성립하지 않습니다. 원문 표에서 직접 확인하세요.";
const AMEND = {
  id: UID, name: "합성규정 개정(안).hwpx",
  판별: { kind: "개정안", 조문수: 0, 근거: ["신구조문 대비표"] },
  교체가능: false, 사유: "신·구조문 대비표(개정안)다",
  개정안: { 제목: "합성규정 개정(안)", 개정이유: ["합성단 신설에 따른 조정"], 시행일: "2026-08-03" },
  후보: [{ path: "20_규정원문/9000_합성/합성규정.md", slug: "합성규정", 규정명: "합성규정", score: 1 }],
  대상: "20_규정원문/9000_합성/합성규정.md",
  제안: [
    { 행: 1, 종류: "변경", 비고: "표 유지", 경고: ["별표(표) 내용이다 — 줄 대조가 성립하지 않는다"],
      변경: [{ 현행줄: "1. 가~ 8. 하 생략", 개정줄: "", 볼트줄: 0, 앵커줄: 0,
               모드: "delete", 반영가능: false, 불가사유: LOCKED, 상태: "미발견" }] },
    { 행: 2, 종류: "변경", 비고: "직책 현행화", 경고: [],
      변경: [
        { 현행줄: "4. 실·팀장은 합성부서의 실장, 기획·행정부서의 팀장임",
          개정줄: "4. 실장은 합성부서, 기획·행정부서의 실장임",
          볼트줄: 13, 앵커줄: 0, 모드: "replace", 반영가능: true, 불가사유: "", 상태: "확정" },
        { 현행줄: "", 개정줄: "6. 합성단장의 위임은 실장 체계를 준용함",
          볼트줄: 0, 앵커줄: 15, 모드: "insert", 반영가능: true, 불가사유: "", 상태: "신설" }] },
  ],
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 } });
await ctx.request.post(BASE + "/api/app/auth/login", { data: { username: USER, password: TEST_PW } });

/** 관리자 게이트·플래그·업로드 목록·개정 미리보기를 합성 응답으로 대체한다. */
async function stub(page, { amendFlag = true } = {}) {
  await page.route("**/app/flags", async (route) => {
    const res = await route.fetch();
    let base = {};
    try { base = await res.json(); } catch { /* 비로그인 등 */ }
    route.fulfill({ response: res, json: { ...base, admin_corpus: true, corpus_amend: amendFlag } });
  });
  await page.route("**/app/flags/manage", (r) => r.fulfill({ json: { flags: [] } }));  // 관리자 게이트 통과
  // ⚠ AdminCorpus는 corpusList가 오기 전엔 조기 반환한다 — 응답 형태를 실제와 맞춰야
  //    업로드 목록·개정 반영 패널까지 렌더된다(2026-08-04 실측: 형태가 틀려 전부 미렌더).
  await page.route("**/app/corpus", (r) => r.fulfill({
    json: { docs: [], summary: { total: 0, excluded: 0, indexed_chunks: 0, needs_reindex: 0 } } }));
  await page.route("**/app/corpus/reindex", (r) =>
    r.fulfill({ json: { running: false, ok: null, log: [], backups: [] } }));
  await page.route("**/app/corpus/uploads", (r) =>
    r.fulfill({ json: { uploads: [{ id: UID, name: AMEND.name, warn: "", kind: "개정안", at: 0 }] } }));
  await page.route(`**/app/corpus/uploads/${UID}/amend*`, (r) => r.fulfill({ json: AMEND }));
  await page.route("**/app/corpus/amend/log*", (r) => r.fulfill({ json: { log: [] } }));
}

// ⓐ 플래그 off — 개정 반영 진입점이 없다
let p = await ctx.newPage();
await stub(p, { amendFlag: false });
await p.goto(`${BASE}/admin/#corpus`, { waitUntil: "load" });
await p.waitForTimeout(2200);
check("① 플래그 off면 개정 반영 버튼 미노출",
      !(await p.getByRole("button", { name: /개정 반영/ }).count()));
await p.close();

// ⓑ~ⓔ 플래그 on
p = await ctx.newPage();
await stub(p);
await p.goto(`${BASE}/admin/#corpus`, { waitUntil: "load" });
await p.waitForTimeout(2200);

check("② 개정안은 목록에서 '승인 대신 반영'으로 안내",
      (await p.getByText(/개정안\(신·구조문 대비표\).*승인 대신 반영/).count()) > 0);
const open = p.getByRole("button", { name: /📋 개정 반영/ });
check("③ 개정 반영 진입 버튼 존재", (await open.count()) === 1, `${await open.count()}개`);
if (await open.count()) {
  await open.first().click();
  await p.waitForTimeout(1400);
}

check("④ 패널이 열린다", (await p.getByText(/개정 반영 — 신·구조문 대비표/).count()) > 0);
check("⑤ 시행일 표시", (await p.getByText("시행일 2026-08-03").count()) > 0);
check("⑥ 전문이 아님을 먼저 알린다", (await p.getByText(/규정 전문이 아니라 개정안/).count()) > 0);

// ⓒ 가장 중요한 계약 — 잠긴 항목은 감추지 않고 **사유를 쓴다**
check("⑦ 잠긴 항목에 🔒 표시", (await p.getByText("🔒 반영 불가").count()) > 0);
check("⑧ 왜 못 누르는지 화면에 쓴다", (await p.getByText(LOCKED).count()) > 0);

// ⓓ 반영 가능한 항목에만 버튼
const applyBtns = p.getByRole("button", { name: /이 줄 반영|블록 반영/ });
check("⑨ 반영 가능한 2건에만 버튼", (await applyBtns.count()) === 2, `${await applyBtns.count()}개`);
check("⑩ 줄 번호/앵커를 짚어준다",
      (await p.getByText("13줄", { exact: false }).count()) > 0
      && (await p.getByText("15줄 뒤", { exact: false }).count()) > 0);

// ⓔ 반영 후 할 일 — 한 줄 고쳤다고 끝이 아니다
check("⑪ 반영 후 재색인·01n_approval 안내", (await p.getByText(/01n_approval\.py/).count()) > 0);

// ⛔ 개정안에는 '승인'(신규 편입)이 없어야 한다 — 누르면 같은 규정의 두 판본이 색인된다
check("⑫ 개정안에 승인 버튼 미노출",
      !(await p.getByRole("button", { name: /가이드로 승인|규정으로 승인/ }).count()));

await p.screenshot({ path: "verify-amend-panel.png", fullPage: false });
await b.close();
finish("개정 반영 패널");
