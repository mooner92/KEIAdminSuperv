// v1 ⑩(S5) 브랜딩 검증 — SITE_NAME 통일·GNB active·파비콘·404 (dev 3101).
import { chromium } from "playwright";

// ⛔ 라이브 계정 비밀번호를 코드에 두지 않는다(보안 스캔 F1/F3/F12).
//    실행: APP_TEST_USER=... APP_TEST_PASS=... node <이 파일>
const TEST_USER = process.env.APP_TEST_USER || "admintest";
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — 검증 계정 비밀번호는 환경변수로만 받습니다.");
  process.exit(2);
}
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.context().request.post(BASE + "/api/app/auth/login", { data: { username: TEST_USER, password: TEST_PW } }); // docs/44 게이트

// 1) 타이틀 통일 + 파비콘
await p.goto(`${BASE}/browse/`, { waitUntil: "networkidle" });
await p.waitForTimeout(800);
ok((await p.title()).includes("KEI 행정 가이드"), `1) 타이틀 SITE_NAME (${await p.title()})`);
ok((await p.locator('link[rel="icon"][href="/favicon.svg"]').count()) > 0, "2) 파비콘 링크 존재");
const fav = await p.request.get(`${BASE}/favicon.svg`);
ok(fav.ok(), `3) favicon.svg 서빙 (${fav.status()})`);
// 혼용 표기 소멸
// 구 명칭은 UI(헤더·푸터·내비)에서만 소멸 확인 — 볼트 콘텐츠(동명 ERP 용어 노트)는 원문 유지가 맞음
const ui = (await p.locator("header").textContent()) + (await p.locator("footer").textContent());
ok(!ui.includes("전직원 연구행정 가이드"), "4) 구 명칭 UI(헤더·푸터)에서 소멸");

// 5) GNB active — browse에서 '규정 둘러보기'가 현재 표시
const cur = await p.locator('nav a[aria-current="page"]').textContent();
ok((cur || "").includes("규정 둘러보기"), `5) GNB 현재 페이지 표시 (${cur})`);
// 6) 'LLM' → '질문하기' 라벨
ok((await p.locator('nav >> text=질문하기').count()) > 0 && (await p.locator('nav >> text=LLM').count()) === 0, "6) 라벨 'LLM'→'질문하기'");
// 7) 그래프로 이동 시 active 이동
await p.goto(`${BASE}/graph/`, { waitUntil: "load" });
await p.waitForTimeout(800);
ok(((await p.locator('nav a[aria-current="page"]').textContent()) || "").includes("관계 그래프"), "7) active가 페이지 따라 이동");

// 8) 404
await p.goto(`${BASE}/없는페이지/`, { waitUntil: "load" });
await p.waitForTimeout(800);
const nf = await p.textContent("body");
ok(nf.includes("페이지를 찾을 수 없어요") && nf.includes("규정 둘러보기"), "8) 커스텀 404 + 복귀 링크");
await p.screenshot({ path: "verify-branding.png" });
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 브랜딩 검증 통과");
process.exit(fails.length ? 1 : 0);
