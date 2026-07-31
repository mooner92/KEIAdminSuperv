// verify-lab.mjs — 실험실(specs/09) 실렌더 검증.
//   ⓐ 비로그인: /lab-assets/·/lab/ 차단(게이트 fail-closed)
//   ⓑ 관리자: 플래그 on → /now 카드 · /lab 카드 · /lab/code-graph iframe 실렌더 + 기준 표기
//   ⓒ 종료 시 플래그 원복(테스트가 운영 상태를 바꾸면 안 된다)
// 실행: set -a; . ../tools/.test_credentials; set +a; APP_TEST_USER=<APP_ADMINS 계정> node verify-lab.mjs
//   (dev 3101/9001 가동 + web/lab-assets 게시본 필요 — scripts/graphify-refresh.sh --publish)
import { chromium } from "playwright";
import { makeCheck } from "./verify-lib.mjs";

const BASE = process.env.BASE || "http://127.0.0.1:3101";
const TEST_USER = process.env.APP_TEST_USER || "b6test";
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — tools/.test_credentials 를 로드하세요.");
  process.exit(2);
}
const { check, finish } = makeCheck();
const b = await chromium.launch();

// ── ⓐ 비로그인 차단 ──
const anon = await b.newContext();
for (const p of ["/lab-assets/code-graph.html", "/lab-assets/code-graph.meta.json"]) {
  const r = await anon.request.get(BASE + p, { maxRedirects: 0 });
  check(`비로그인 ${p} 차단`, r.status() === 302, `HTTP ${r.status()}`);
}
{
  const r = await anon.request.get(BASE + "/lab/", { maxRedirects: 0 });
  check("비로그인 /lab/ 차단(302)", r.status() === 302, `HTTP ${r.status()}`);
}
await anon.close();

// ── 로그인(관리자) + 플래그 on(원상태 기억) ──
const ctx = await b.newContext();
await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: TEST_USER, password: TEST_PW } });
const before = await (await ctx.request.get(`${BASE}/api/app/flags`)).json();
const flags0 = before.flags || before;
const prev = { lab_hub: !!flags0.lab_hub, lab_code_graph: !!flags0.lab_code_graph };
const setFlag = async (k, v) => {
  const r = await ctx.request.post(`${BASE}/api/app/flags/${k}`, { data: { enabled: v } });
  return r.ok();
};
const adminOk = await setFlag("lab_hub", true);
check("플래그 토글 권한(관리자)", adminOk, adminOk ? "" : `APP_TEST_USER=${TEST_USER} 가 APP_ADMINS인지 확인`);
if (!adminOk) { await b.close(); process.exit(finish()); }
await setFlag("lab_code_graph", true);

try {
  // ── ⓑ 실렌더 ──
  const p = await ctx.newPage();
  await p.goto(`${BASE}/now/`, { waitUntil: "networkidle" });
  check("/now 실험실 카드", await p.getByText("실험실", { exact: false }).count() > 0);

  await p.goto(`${BASE}/lab/`, { waitUntil: "networkidle" });
  check("/lab 실험 카드(코드 그래프)", await p.getByText("코드 그래프 — 실험 중").count() === 1);
  check("/lab 졸업 기준 표기", await p.getByText("졸업 기준").count() >= 1);

  await p.goto(`${BASE}/lab/code-graph/`, { waitUntil: "networkidle" });
  check("기준 커밋·날짜 표기", await p.getByText(/그래프 기준:/).count() === 1);
  const frame = p.frameLocator('iframe[title="호롱 코드 그래프"]');
  // vis-network가 로컬 사본으로 로드돼 캔버스가 실제로 그려지는지(CDN 치환의 실증)
  await frame.locator("canvas").first().waitFor({ timeout: 20_000 });
  check("iframe 그래프 캔버스 렌더(로컬 vis-network)", true);

  const assets = await ctx.request.get(`${BASE}/lab-assets/code-graph.html`);
  check("로그인 후 게시본 200", assets.status() === 200, `HTTP ${assets.status()}`);
  const body = await assets.text();
  check("게시본에 외부 로드 없음", !/<(script|link)[^>]+(src|href)="https?:\/\//.test(body));
} finally {
  // ── ⓒ 원복 ──
  await setFlag("lab_hub", prev.lab_hub);
  await setFlag("lab_code_graph", prev.lab_code_graph);
}
await b.close();
process.exit(finish());
