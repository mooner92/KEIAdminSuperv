// 전사 시스템 적재 실렌더 검증(dev 3101): 둘러보기 '사내 시스템' 섹션 + 시스템별 분류 필터 + 그래프 클러스터.
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });

// 1) 둘러보기: 섹션 라벨 + 분류 필터 + 신규 노트
await p.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
let body = await p.textContent("body");
ok(body.includes("사내 시스템"), "1) 섹션 라벨 '사내 시스템'");
for (const cat of ["행정관리(ERP)", "연구관리(PMS)", "그룹웨어", "웹메일", "웹디스크", "전자도서관", "통합포털(EIP)"])
  ok(body.includes(cat), `2) 분류 필터 '${cat}'`);
// 그룹웨어 분류 체크 → 전자결재 노트 노출
const gw = p.locator("label", { hasText: "그룹웨어" }).first();
await gw.click().catch(() => {});
await p.waitForTimeout(600);
body = await p.textContent("body");
ok(body.includes("전자결재"), "3) '그룹웨어' 필터 → 전자결재 노트 노출");
await p.screenshot({ path: "verify-systems-browse.png", fullPage: false });

// 2) 문서 페이지: 그룹웨어 · 전자결재
await p.goto(`${BASE}/d/그룹웨어 · 전자결재/`, { waitUntil: "networkidle" });
await p.waitForTimeout(800);
body = await p.textContent("body");
ok(body.includes("양식함") && body.includes("결재대기"), "4) '그룹웨어 · 전자결재' 본문 렌더(양식함·결재대기)");
ok(body.includes("관련 규정"), "5) 교차링크 '관련 규정' 섹션 렌더");

// 3) 그래프: 시스템 노드 존재(데이터 확인)
await p.goto(`${BASE}/graph/`, { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
body = await p.textContent("body");
ok(body.includes("사내 시스템"), "6) 그래프 범례 '사내 시스템'");
await p.screenshot({ path: "verify-systems-graph.png", fullPage: false });

await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 전사 시스템 적재 검증 통과");
process.exit(fails.length ? 1 : 0);
