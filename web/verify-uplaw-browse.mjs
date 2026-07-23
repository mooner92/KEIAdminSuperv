// 상위법령 둘러보기·그래프 노출 검증(docs/61): 섹션 필터·목록 칩·문서 콜아웃·그래프 노드·엣지.
import { chromium } from "playwright";
const BASE="http://localhost:3101";
const fails=[]; const ok=(c,m)=>{ console.log((c?"✅ ":"❌ ")+m); if(!c) fails.push(m); };
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1440,height:900}});
let r=await ctx.request.post(`${BASE}/api/app/auth/login`,{data:{username:"fb_test",password:"test1234"}});
ok(r.ok(),`0) 로그인 (${r.status()})`);
const p=await ctx.newPage();
// 1) 둘러보기 섹션 필터
await p.goto(`${BASE}/browse`,{waitUntil:"load"}); await p.waitForTimeout(1200);
ok(await p.locator('label:has-text("상위 법령(참고)")').count()>0,"1) 섹션 필터에 '상위 법령(참고)'");
await p.locator('label:has-text("상위 법령(참고)")').first().click(); await p.waitForTimeout(600);
const rows=await p.locator('[data-section="상위법령"]').count();
ok(rows>0,`2) 상위법령 필터 결과 칩 렌더(${rows}개 보임)`);
ok(await p.locator('text=근로기준법').count()>0,"3) 근로기준법 노출");
// 2) 문서 페이지 콜아웃+태그
await p.goto(`${BASE}/d/${encodeURIComponent("근로기준법")}/`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(800);
ok(await p.locator('text=KEI 사내 규정이 아닌 상위 규범').count()>0,"4) 문서 상단 '사내 규정 아님' 콜아웃");
ok(await p.locator('text=/⚖ 상위 법령 · 적용강도/').count()>0,"5) ⚖ 적용강도 태그");
ok(await p.locator('text=제60조').count()>0,"6) 조문 본문 렌더(제60조)");
// 3) 그래프 — 노드 데이터에 상위법령 포함 + 엣지(백링크로 간접 확인: 유연근무제→근로기준법)
const dd=await (await ctx.request.get(`${BASE}/docdata/${encodeURIComponent("근로기준법")}.json`)).json();
const bl=(dd.backlinks||[]).map(x=>x.title||x.slug);
ok(bl.length>0,`7) 근로기준법 백링크(사내 규정→법령 엣지) ${bl.length}건: ${bl.slice(0,3).join(", ")}…`);
await p.screenshot({path:"verify-uplaw-browse.png"});
await b.close();
console.log(fails.length===0?"\n🎉 전부 통과":`\n⚠ 실패 ${fails.length}: ${fails.join(" · ")}`);
process.exit(fails.length?1:0);
