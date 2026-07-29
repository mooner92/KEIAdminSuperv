// /quality 문서 링크 버그 수정 검증: 출처.slug 주입 → /d/<slug>/ 200(구 규정명 링크는 404).
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
const ctx=await b.newContext();
let r=await ctx.request.post(`${BASE}/api/app/auth/register`,{data:{username:USER,password:PW}});
if(!r.ok()) r=await ctx.request.post(`${BASE}/api/app/auth/login`,{data:{username:USER,password:PW}});
ok(r.ok(),`0) 로그인 (${r.status()})`);
const p=await ctx.newPage();
// 공개 json에 slug 주입 확인
const j=await (await ctx.request.get(`${BASE}/quality/daily/2026-07-22.json`)).json();
const withSrc=j.문항.filter(i=>i.출처?.규정명);
const withSlug=withSrc.filter(i=>i.출처.slug);
ok(withSlug.length===withSrc.length,`1) 공개 json 출처 ${withSrc.length}건 전부 slug 주입 (${withSlug.length})`);
const sample=withSrc.find(i=>i.출처.규정명==="웹사이트운영관리규칙")||withSrc[0];
ok(sample.출처.slug && sample.출처.slug!==sample.출처.규정명,
   `2) slug≠규정명(번호 프리픽스): ${sample.출처.규정명} → ${sample.출처.slug}`);
// 신 링크 200 + 404 화면 아님
const good=await p.goto(`${BASE}/d/${encodeURIComponent(sample.출처.slug)}/`,{waitUntil:"domcontentloaded"});
ok(good.status()===200,`3) 신 링크 /d/${sample.출처.slug}/ → 200`);
await p.waitForTimeout(400);
ok(await p.locator("text=페이지를 찾을 수 없어요").count()===0,"4) 정상 문서 렌더(404 화면 아님)");
// 대조: 규정명-only 구 링크는 404
const bad=await p.goto(`${BASE}/d/${encodeURIComponent(sample.출처.규정명)}/`,{waitUntil:"domcontentloaded"});
ok(bad.status()===404 || await p.locator("text=페이지를 찾을 수 없어요").count()>0,"5) (대조) 구 규정명-only 링크는 404");
// 실제 게시판 UI에서 문항 펼쳐 링크 클릭
await p.goto(`${BASE}/quality`,{waitUntil:"load"});
await p.waitForTimeout(1200);
const rows=await p.locator('[class*="qRow"]').count();
if(rows>0){
  await p.locator('[class*="qRow"]').first().click();
  await p.waitForTimeout(300);
  const link=p.locator('[class*="srcLink"]').first();
  if(await link.count()>0){
    const href=await link.getAttribute("href");
    ok(/\/d\/.+\d{3,4}_|\/d\/[^/]+\//.test(href),`6) 게시판 링크 href 존재: ${decodeURIComponent(href)}`);
  } else ok(true,"6) (첫 문항 출처 없음 — skip)");
} else ok(false,"6) 문항 행 렌더 실패");
await b.close();
console.log(fails.length===0?`\n🎉 전부 통과`:`\n⚠ 실패 ${fails.length}: ${fails.join(" · ")}`);
process.exit(fails.length?1:0);
