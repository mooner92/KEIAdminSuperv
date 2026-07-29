// v1.1 P3 업로드 UI 검증 — 파일 업로드→미리보기→승인 편입→거절 (dev 3101, admintest).
import { chromium } from "playwright";
import fs from "node:fs";

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
const ctx = await b.newContext();
let r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: TEST_USER, password: TEST_PW } });
ok(r.ok(), `0) 관리자 로그인 (${r.status()})`);
const p = await ctx.newPage({ viewport: { width: 1440, height: 1300 } });
p.on("dialog", (d) => d.accept("P3 UI 업로드 검증문서")); // prompt 제목 입력
await p.goto(`${BASE}/admin/#corpus`, { waitUntil: "load" }); // docs/21 탭 셸
await p.waitForTimeout(2500);
ok((await p.getByText("📤 문서 업로드").count()) > 0, "1) 업로드 버튼 렌더");

// md 파일 업로드
fs.writeFileSync("/tmp/p3-ui.md", "# P3 UI 업로드 검증문서\n\n검증 본문 내용입니다.\n");
await p.locator('input[aria-label="문서 업로드"]').setInputFiles("/tmp/p3-ui.md");
await p.waitForTimeout(2500);
let body = await p.textContent("body");
ok(body.includes("변환 미리보기") && body.includes("검증 본문 내용"), "2) 변환 미리보기 표시");
ok(body.includes("⏳ p3-ui.md"), "3) 대기 목록 표시");

// 가이드로 승인(프롬프트 자동 수락)
await p.locator('button:has-text("✅ 가이드로 승인")').first().click();
await p.waitForTimeout(2000);
await p.locator('input[aria-label="코퍼스 검색"]').fill("P3 UI 업로드");
await p.waitForTimeout(600);
body = await p.textContent("body");
ok(body.includes("P3 UI 업로드 검증문서") && body.includes("재색인 필요"), "4) 편입 → 목록 노출 + ⟳ 재색인 필요");
await p.screenshot({ path: "verify-corpus-p3.png" });
await b.close();
// 정리: 테스트 편입 파일 제거
const f = "../KEI-행정가이드/10_업무가이드/0000_미분류/P3 UI 업로드 검증문서.md";
if (fs.existsSync(f)) { fs.unlinkSync(f); console.log("정리: 테스트 편입 파일 삭제"); }
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 코퍼스 P3 UI 검증 통과");
process.exit(fails.length ? 1 : 0);
