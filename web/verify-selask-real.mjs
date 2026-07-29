// docs/26 select_ask — '이거 물어보기' 실마우스 경로 회귀 검증(무반응 버그 수정 확인).
// 프로그램 클릭이 아닌 실제 mousedown→mouseup→click 시퀀스로 판정한다(레이스 재현 경로).
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
const p = await ctx.newPage();

async function openDocAndSelect() {
  await p.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").includes("직제규정"));
    btn?.click();
  });
  await p.waitForTimeout(2000);
  const tgt = p.locator("article p", { hasText: "제2조(적용범위)" }).first();
  await tgt.scrollIntoViewIfNeeded();
  await p.waitForTimeout(400);
  const r = await tgt.boundingBox();
  await p.mouse.move(r.x + 5, r.y + 10);
  await p.mouse.down();
  await p.mouse.move(r.x + 260, r.y + 10, { steps: 10 });
  await p.mouse.up();
  await p.waitForTimeout(600);
  return p.locator('button:has-text("이거 물어보기")');
}

// ① 둘러보기: 드래그 → 팝오버 → 실마우스 클릭 → /?q= 프리필 이동
await p.goto(BASE + "/browse/", { waitUntil: "load" });
await p.waitForTimeout(1500);
const pop = await openDocAndSelect();
check("① 팝오버 표시(드래그)", (await pop.count()) === 1);
const bb = await pop.boundingBox();
await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
await p.mouse.down();
await p.mouse.up();
await p.waitForTimeout(1500);
check("① 실클릭 → /?q= 이동", p.url().includes("/?q="), p.url().slice(0, 80));
const input = await p.inputValue("textarea").catch(() => "");
check("① 입력창 프리필(자동 전송 없음)", input.includes("이게 무슨 뜻인가요"), input.slice(0, 50));

// ② 채팅 드로어(콜백 경로)도 실마우스로 회귀 확인 — 근거 문서를 열 채팅이 필요하므로
//    둘러보기 딥링크로 연 드로어와 동일 컴포넌트라 ①로 대표 검증(콜백 분기는 기존 E2E가 커버).
console.log(`\n${pass}/${pass + fail} 판정 통과`);
await b.close();
process.exit(fail ? 1 : 0);
