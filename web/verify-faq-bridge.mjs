// FAQ 브리지(docs/58 §6) E2E: 탭 노출 → 후보 열람 → 편입(볼트 파일 생성+재색인 필요 표시) → 상태 갱신.
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
const BASE="http://localhost:3101";
const fails=[]; const ok=(c,m)=>{ console.log((c?"✅ ":"❌ ")+m); if(!c) fails.push(m); };
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1400,height:900}});
let r=await ctx.request.post(`${BASE}/api/app/auth/login`,{data:{username:TEST_USER,password:TEST_PW}});
ok(r.ok(),`0) 관리자 로그인 (${r.status()})`);
const p=await ctx.newPage();
await p.goto(`${BASE}/admin#faq`,{waitUntil:"load"}); await p.waitForTimeout(1500);
ok(await p.locator('button:has-text("FAQ 브리지")').count()>0,"1) 🌉 FAQ 브리지 탭 노출(플래그 on)");
ok(await p.locator('text=검색이 근거를 못 찾아 틀린 질문').count()>0,"2) 탭 진입 + 설명문 렌더");
ok(await p.locator('text=/1건/').count()>0,"3) PagedList 건수(1건)");
const row=p.locator('text=웹사이트에 신규 서비스 메뉴를 개발하려면').first();
ok(await row.count()>0,"4) 후보 행 렌더");
await row.click(); await p.waitForTimeout(300);
ok(await p.locator('textarea').count()>0,"5) 펼침 — 인용 편집 textarea");
ok(await p.locator('button:has-text("볼트에 편입")').count()>0,"6) [편입]·[기각] 버튼");
// 편입 실행(confirm 수락)
p.on("dialog",(d)=>d.accept());
await p.locator('button:has-text("볼트에 편입")').click();
await p.waitForTimeout(1500);
ok(await p.locator('text=/✅ 편입: 10_업무가이드\\/FAQ\\//').count()>0,"7) 편입 성공 메시지(경로 표기)");
// 볼트 파일 실존 + 내용 검증(인용+링크만, 검수상태 미검수)
const dir="/home/mhchoi/kei-dev-0703/KEI-행정가이드/10_업무가이드/FAQ";
const files=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>f.startsWith("FAQ-")):[];
ok(files.length>0,`8) 볼트 FAQ 노트 생성: ${files[0]||"없음"}`);
if(files.length){
  const body=fs.readFileSync(`${dir}/${files[0]}`,"utf-8");
  ok(body.includes("검수상태: 미검수"),"9) 검수상태 미검수 유지");
  ok(body.includes("「")&&body.includes("[[웹사이트운영관리규칙#제8조]]"),"10) 본문 = 원문 인용+[[링크]](생성 답변 없음)");
}
// 상태 applied 반영(전체 필터)
await p.locator('button[role="tab"]:has-text("전체")').first().click(); await p.waitForTimeout(400);
ok(await p.locator('text=✅ 편입됨').count()>0,"11) 상태 '편입됨' 반영");
// 재색인 필요 표시(stale)
const stale=JSON.parse(fs.readFileSync("/home/mhchoi/kei-dev-0703/tools/index/reindex_stale.json","utf-8").toString()||"{}");
ok((stale.stale||[]).some(s=>s.startsWith("FAQ-")),`12) 재색인 필요(stale) 등록: ${(stale.stale||[]).filter(s=>s.startsWith("FAQ-"))[0]||"없음"}`);
await p.screenshot({path:"verify-faq-bridge.png"});
await b.close();
console.log(fails.length===0?"\n🎉 전부 통과":`\n⚠ 실패 ${fails.length}: ${fails.join(" · ")}`);
process.exit(fails.length?1:0);
