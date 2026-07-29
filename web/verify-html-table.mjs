// HTML 표 렌더(docs/61 K1ⓑ) 검증: kordoc 병합 셀 표가 실표로, raw 텍스트 노출 없음, XSS 무해화.
import { chromium } from "playwright";

// ⛔ 테스트 계정 비밀번호를 코드에 두지 않는다(보안 스캔 후속 — dev 계정 14개가
//    레포에 박힌 비밀번호로 열리던 것을 2026-07-29에 회전).
//    실행: set -a; . tools/.test_credentials; set +a; node <이 파일>
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — tools/.test_credentials 를 로드하세요.");
  process.exit(2);
}
const BASE="http://localhost:3101";
const fails=[]; const ok=(c,m)=>{ console.log((c?"✅ ":"❌ ")+m); if(!c) fails.push(m); };
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1440,height:900}});
await ctx.request.post(`${BASE}/api/app/auth/login`,{data:{username:"fb_test",password:TEST_PW}});
const p=await ctx.newPage();
// 1) 연구윤리 규정 별표 — 실표 렌더
await p.goto(`${BASE}/d/${encodeURIComponent("경제·인문사회연구회 연구윤리 규정")}/`,{waitUntil:"domcontentloaded"});
await p.waitForTimeout(900);
const tables=await p.locator("article table, main table").count();
ok(tables>0,`1) 실제 <table> 렌더(${tables}개)`);
const raw=await p.locator('text=/<table>|<tr><th>/').count();
ok(raw===0,"2) raw HTML 텍스트 노출 없음");
const rowspan=await p.locator('td[rowspan], th[rowspan], td[colspan]').count();
ok(rowspan>0,`3) 병합 셀(rowspan/colspan) 보존(${rowspan}개)`);
// 2) 기존 파이프 표 문서 회귀 없음(위임전결규정 등 markdown 표)
await p.goto(`${BASE}/d/${encodeURIComponent("2300_위임전결규정")}/`,{waitUntil:"domcontentloaded"});
await p.waitForTimeout(700);
ok(await p.locator("table").count()>0,"4) 기존 마크다운 표 회귀 없음");
// 3) 드로어(둘러보기)에서도 렌더
await p.goto(`${BASE}/browse/?doc=${encodeURIComponent("경제·인문사회연구회 연구윤리 규정")}`,{waitUntil:"load"});
await p.waitForTimeout(1200);
const dTbl=await p.locator("table").count();
ok(dTbl>0,`5) 드로어에서도 실표 렌더(${dTbl}개)`);
await p.screenshot({path:"verify-html-table.png"});
await b.close();
console.log(fails.length===0?"\n🎉 전부 통과":`\n⚠ 실패 ${fails.length}: ${fails.join(" · ")}`);
process.exit(fails.length?1:0);
