// docs/29 §1 실렌더 검증 — 빈 화면 '요즘 많이 찾는 키워드' 칩(k-익명 집계·클릭=프리필·무전송).
// dev(3101/9001) + flag trending_keywords ON + 집계 데이터(서로 다른 사용자 3명+) 필요.
import { chromium } from "playwright";

// ⛔ 라이브 계정 비밀번호를 코드에 두지 않는다(보안 스캔 F1/F3/F12).
//    실행: APP_TEST_USER=... APP_TEST_PASS=... node <이 파일>
const TEST_USER = process.env.APP_TEST_USER || "admintest";
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — 검증 계정 비밀번호는 환경변수로만 받습니다.");
  process.exit(2);
}

const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.request.post(BASE + "/api/app/auth/login", { data: { username: TEST_USER, password: TEST_PW } });
const p = await ctx.newPage();
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log((ok ? "✅" : "❌") + " " + name + (detail ? " — " + detail : ""));
  ok ? pass++ : fail++;
};

await p.goto(BASE + "/", { waitUntil: "load" });
await p.waitForTimeout(1800);
// 새 대화(빈 상태) 진입
await p.click('button:has-text("＋ 새 대화")').catch(() => {});
await p.waitForTimeout(1500);

const body = await p.innerText("body");
check("① 인기 키워드 블록 노출", body.includes("요즘 많이 찾는 키워드"));

// 칩 클릭 → 입력 프리필(자동 전송 없음)
const chipRow = p.locator("text=요즘 많이 찾는 키워드").locator("xpath=..");
const chips = chipRow.locator("button");
const nChips = await chips.count();
check("② 키워드 칩 렌더(1~10개)", nChips >= 1 && nChips <= 10, `${nChips}개`);
const label = (await chips.first().innerText()).trim();
const msgsBefore = await p.locator("ul li").count();
await chips.first().click();
await p.waitForTimeout(500);
const inputVal = await p.inputValue("textarea").catch(() => p.inputValue("input[placeholder*='행정']"));
check("③ 클릭 시 입력 프리필", inputVal.trim().startsWith(label), `"${inputVal}"`);
const msgsAfter = await p.locator("ul li").count();
check("③ 자동 전송 없음", msgsAfter === msgsBefore);
await p.screenshot({ path: "verify-trending.png" });

// ④ 일반어 노이즈 제외('신청' 단독 칩 없음)
const chipTexts = [];
for (let i = 0; i < nChips; i++) chipTexts.push((await chips.nth(i).innerText()).trim());
check("④ 일반어(신청) 단독 칩 없음", !chipTexts.includes("신청"), chipTexts.join(","));

console.log(`\n${pass}/${pass + fail} 판정 통과`);
await b.close();
process.exit(fail ? 1 : 0);
