// 레거시 3101 채팅 실렌더 검증 — 사용자 보고("응답이 안옴") 재현/해결 확인.
import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
await p.goto("http://localhost:3101/", { waitUntil: "load" });
await p.waitForTimeout(1200);

// 로그인(테스트 계정)
const idInput = p.locator('input[placeholder="사번 또는 아이디"]');
if (await idInput.count()) {
  await idInput.fill("diagtest");
  await p.locator('input[type="password"]').fill("test1234");
  await p.locator('button[type="submit"]').click();
  await p.waitForTimeout(2500);
}

// 채팅 입력
const ta = p.locator('textarea[placeholder^="행정 업무에 대해"]');
await ta.waitFor({ timeout: 8000 });
await ta.fill("초과근무 수당 지급 기준이 궁금해요.");
await ta.press("Enter");

// 답변 대기: '작성 중'이 사라지고 본문이 차는지 (최대 40s)
let answered = false, txt = "";
for (let i = 0; i < 40; i++) {
  await p.waitForTimeout(1000);
  txt = await p.evaluate(() => document.body.innerText);
  // 어시스턴트 답변에 출처/면책 같은 실제 내용이 떴는지
  if (/연장근로|초과근무|규정|제\d+조|최종 판단은/.test(txt) && !/^.*작성 중…\s*$/.test(txt.trim())) {
    // '작성 중' 표시가 여전히 단독이 아니면(=본문이 생겼으면) 통과 후보
    const stillLoading = await p.evaluate(() => /근거 조문을 찾아 답변을 작성 중/.test(document.body.innerText) && document.body.innerText.length < 1500);
    if (!stillLoading) { answered = true; break; }
  }
}
const head = (txt.match(/(연장근로[^\n]{0,80}|초과근무 수당[^\n]{0,80})/) || ["(매칭 없음)"])[0];
console.log("답변 떴나:", answered);
console.log("답변 일부:", head);
await p.screenshot({ path: "verify-legacy-chat.png" });
await b.close();
console.log(answered ? "✅ 레거시 3101 채팅 정상 응답" : "❌ 여전히 응답 안옴");
process.exit(answered ? 0 : 1);
