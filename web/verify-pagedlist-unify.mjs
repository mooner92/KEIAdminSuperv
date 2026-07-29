// PagedList 통일 리팩터 검증: /deadlines·/forms 페이지네이션·필터 동작 불변.
import { chromium } from "playwright";

// ⛔ 테스트 계정 비밀번호를 코드에 두지 않는다(보안 스캔 후속 — dev 계정 14개가
//    레포에 박힌 비밀번호로 열리던 것을 2026-07-29에 회전).
//    실행: set -a; . tools/.test_credentials; set +a; node <이 파일>
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — tools/.test_credentials 를 로드하세요.");
  process.exit(2);
}
const BASE="http://localhost:3101", USER="fb_test", PW=TEST_PW;
const fails=[]; const ok=(c,m)=>{ console.log((c?"✅ ":"❌ ")+m); if(!c) fails.push(m); };
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1400,height:900}});
let r=await ctx.request.post(`${BASE}/api/app/auth/login`,{data:{username:USER,password:PW}});
ok(r.ok(),`0) 로그인 (${r.status()})`);
const p=await ctx.newPage();

// ── /deadlines ──
await p.goto(`${BASE}/deadlines`,{waitUntil:"load"}); await p.waitForTimeout(800);
const dCount=await p.locator('text=/^\\d+건/').first().textContent().catch(()=>null);
ok(!!dCount,`1) deadlines 건수 표시(PagedList): ${dCount}`);
ok(await p.locator('button:has-text("30개씩")').count()>0,"2) deadlines N개씩 칩 존재");
ok(await p.locator('[role="tab"]:has-text("마감")').count()>0,"3) deadlines 유형 칩이 상단 줄(filterSlot)에 존재");
const dRows1=await p.locator('ul li').count();
await p.locator('button:has-text("10개씩")').first().click(); await p.waitForTimeout(300);
const dRows2=await p.locator('ul li').count();
ok(dRows2<=10 && dRows2<dRows1+1,`4) deadlines 10개씩 전환 동작(${dRows1}→${dRows2})`);
// 페이저 › 이동
await p.locator('button[aria-label="다음 페이지"]').first().click(); await p.waitForTimeout(300);
ok((await p.locator('text=/2 \\/ \\d+/').count())>0,"5) deadlines 다음 페이지 이동(2/N)");
// 유형 필터 → 1페이지 복귀(resetKey)
await p.locator('[role="tab"]:has-text("마감")').first().click(); await p.waitForTimeout(300);
ok((await p.locator('text=/1 \\/ \\d+/').count())>0,"6) deadlines 필터 변경 → 1페이지 복귀(resetKey)");

// ── /forms ──
await p.goto(`${BASE}/forms`,{waitUntil:"load"}); await p.waitForTimeout(800);
const fCount=await p.locator('text=/^\\d+건/').first().textContent().catch(()=>null);
ok(!!fCount,`7) forms 건수 표시(PagedList): ${fCount}`);
const fRows1=await p.locator('table tbody tr').count();
ok(fRows1>0 && fRows1<=30,`8) forms 테이블 렌더 30행 이내(${fRows1})`);
await p.locator('button:has-text("50개씩")').first().click(); await p.waitForTimeout(300);
const fRows2=await p.locator('table tbody tr').count();
ok(fRows2>fRows1,`9) forms 50개씩 전환(${fRows1}→${fRows2})`);
// 검색 → 건수 축소 + 1페이지
await p.locator('input[aria-label="서식 검색"]').fill("출장"); await p.waitForTimeout(400);
const fCountQ=await p.locator('text=/^\\d+건/').first().textContent();
ok(parseInt(fCountQ)<parseInt(fCount),`10) forms 검색 필터링(${fCount.trim()}→${fCountQ.trim()})`);
// 빈 결과 empty 문구
await p.locator('input[aria-label="서식 검색"]').fill("zzz없는서식zzz"); await p.waitForTimeout(400);
ok(await p.locator('text=검색 결과가 없어요').count()>0,"11) forms 빈 결과 문구(PagedList empty)");
await p.screenshot({path:"verify-pagedlist-unify.png",fullPage:false});
await b.close();
console.log(fails.length===0?"\n🎉 전부 통과":`\n⚠ 실패 ${fails.length}: ${fails.join(" · ")}`);
process.exit(fails.length?1:0);
