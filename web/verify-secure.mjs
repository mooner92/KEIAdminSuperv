// docs/44 — 서버 로그인 게이트(secure check) 실검증.
// 비로그인: 랜딩 셸(/,/about)만 · 콘텐츠(문서/JSON/RAG)는 전부 차단 → 랜딩으로.
// 로그인: 전부 통과. 랜딩 소개 카드는 서비스로 이동하지 않아야 한다(외부 공개 대비).
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

// ── ① 비로그인 HTTP 매트릭스(리다이렉트 미추적) ──
const anon = await b.newContext();
const code = async (p, opts = {}) => (await anon.request.fetch(BASE + p, { maxRedirects: 0, ...opts })).status();
check("① 공개: /", (await code("/")) === 200);
check("① 공개: /about/", (await code("/about/")) === 200);
check("① 공개: /api/app/flags", (await code("/api/app/flags")) === 200);
for (const p of ["/browse/", "/graph/", "/journey/", "/calendar/", "/forms/", "/now/", "/changelog/", "/admin/", "/help/", "/approval/"]) {
  check(`① 차단(302→랜딩): ${p}`, (await code(p)) === 302);
}
for (const p of ["/search-index.json", "/changelog.json", "/approval.json", "/docdata/%EC%97%AC%EB%B9%84%EA%B7%9C%EC%A0%95.json"]) {
  check(`① 차단(302): ${p.slice(0, 30)}`, (await code(p)) === 302);
}
// 문서 페이지 + 페이지 데이터 JSON(_next/data)도 차단
check("① 차단: /d/<slug>/", (await code("/d/%EC%A0%95%EA%B4%80/")) === 302);
const buildId = await anon.request.fetch(BASE + "/").then(async (r) => (await r.text()).match(/"buildId":"([^"]+)"/)?.[1]);
if (buildId) {
  check("① 공개: _next/data index.json", (await code(`/_next/data/${buildId}/index.json`)) === 200);
  check("① 차단: _next/data browse.json", (await code(`/_next/data/${buildId}/browse.json`)) === 302);
}
// RAG API(무인증 /v1 프록시)는 401
check("① 차단(401): POST /api/rag/chat", (await code("/api/rag/chat", { method: "post", data: { messages: [] } })) === 401);

// ── ② 비로그인 브라우저: 차단 경로 직접 진입 → 랜딩으로 착지 ──
const ap = await anon.newPage();
await ap.goto(BASE + "/browse/", { waitUntil: "load" });
await ap.waitForTimeout(800);
check("② /browse/ 직접 진입 → 랜딩 착지", new URL(ap.url()).pathname === "/");
const apBody = await ap.innerText("body");
check("② 랜딩에 규정 목록 미노출", !apBody.includes("정부출연연구기관"));

// ── ③ /about 소개 카드가 서비스로 이동하지 않음(외부 공개 대비) ──
await ap.goto(BASE + "/about/", { waitUntil: "load" });
await ap.waitForTimeout(1200);
for (const p of ["/browse/", "/graph/", "/forms/"]) {
  check(`③ 소개 카드에 ${p} 링크 없음`, (await ap.locator(`a[href="${p}"]`).count()) === 0);
}
check("③ 소개 카드 텍스트는 유지(프레젠테이션)", (await ap.innerText("body")).includes("규정 둘러보기"));

// ── ④ 로그인 후: 전부 통과 ──
const authed = await b.newContext();
await authed.request.post(BASE + "/api/app/auth/login", { data: { username: TEST_USER, password: TEST_PW } });
const acode = async (p) => (await authed.request.fetch(BASE + p, { maxRedirects: 0 })).status();
for (const p of ["/browse/", "/journey/", "/calendar/", "/search-index.json"]) {
  check(`④ 로그인: ${p} 200`, (await acode(p)) === 200);
}

// ── ⑤ 보안 헤더·robots (docs/44 §2 추가 조치) ──
const hres = await anon.request.fetch(BASE + "/");
const csp = hres.headers()["content-security-policy"] || "";
check("⑤ CSP 적용(외부 오리진 차단)", csp.includes("default-src 'self'") && csp.includes("frame-ancestors 'none'"), csp.slice(0, 60));
check("⑤ COOP/CORP 헤더", hres.headers()["cross-origin-opener-policy"] === "same-origin" && hres.headers()["cross-origin-resource-policy"] === "same-origin");
const robots = await anon.request.fetch(BASE + "/robots.txt");
check("⑤ robots.txt 색인 금지", robots.status() === 200 && (await robots.text()).includes("Disallow: /"));

// ── ⑥ 브루트포스·입력 정책 ──
// 로그인 RL: 실패 8회/5분(사용자+IP) — 무작위 계정으로 검사(admintest 잠금·상태 오염 방지)
const rnd = `rl-test-${Math.random().toString(36).slice(2, 8)}`;
let last = 0;
for (let i = 0; i < 9; i++) {
  last = (await anon.request.post(BASE + "/api/app/auth/login", { data: { username: rnd, password: "wrong-pw-xx" } })).status();
}
check("⑥ 로그인 브루트포스 → 429", last === 429, String(last));
// 비밀번호 정책 8자
const shortPw = await anon.request.post(BASE + "/api/app/auth/register", { data: { username: "policy-test@kei.re.kr", password: "short" } });
check("⑥ 비밀번호 8자 미만 가입 거부", shortPw.status() === 400);
// 요청 본문 상한(2MB) → 413
const big = await anon.request.post(BASE + "/api/app/auth/login", {
  data: { username: "x", password: "y".repeat(3 * 1024 * 1024) },
}).then((r) => r.status()).catch(() => 413);
check("⑥ 초대형 본문(3MB) → 413", big === 413, String(big));

console.log(`\n${pass}/${pass + fail} 판정 통과`);
await b.close();
process.exit(fail ? 1 : 0);
