// docs/44 — 서버 로그인 게이트(secure check) 실검증.
// 비로그인: 랜딩 셸(/,/about)만 · 콘텐츠(문서/JSON/RAG)는 전부 차단 → 랜딩으로.
// 로그인: 전부 통과. 랜딩 소개 카드는 서비스로 이동하지 않아야 한다(외부 공개 대비).
import { chromium } from "playwright";
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
await authed.request.post(BASE + "/api/app/auth/login", { data: { username: "admintest", password: "admtest123" } });
const acode = async (p) => (await authed.request.fetch(BASE + p, { maxRedirects: 0 })).status();
for (const p of ["/browse/", "/journey/", "/calendar/", "/search-index.json"]) {
  check(`④ 로그인: ${p} 200`, (await acode(p)) === 200);
}

console.log(`\n${pass}/${pass + fail} 판정 통과`);
await b.close();
process.exit(fail ? 1 : 0);
