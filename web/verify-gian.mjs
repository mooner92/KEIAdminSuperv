// 전자결재 '기안' 노트 적재 + 크로스링크 실렌더 검증 (dev 3101).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1300 } });

// 1) 둘러보기: 기안 노트 + 분류 필터
await p.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
let body = await p.textContent("body");
ok(body.includes("전자결재 기안"), "1) 둘러보기에 '전자결재 기안' 노트 노출");
ok(body.includes("전자결재(기안)"), "2) 분류 필터 '전자결재(기안)' 생성");

// 2) 기안 결재상신 공통 문서: 핵심 화면 + 일상감사 렌더
await p.goto(`${BASE}/d/전자결재 기안 · 결재상신 공통/`, { waitUntil: "networkidle" });
await p.waitForTimeout(900);
body = await p.textContent("body");
ok(body.includes("결재선 설정") && body.includes("일상감사"), "3) 결재상신 공통 본문(결재선·일상감사) 렌더");
ok(body.includes("기록물철") && body.includes("결재올림"), "4) 편철·결재올림 렌더");
ok(body.includes("관련 규정"), "5) 규정 교차링크 섹션 렌더");
await p.screenshot({ path: "verify-gian-doc.png" });

// 3) ERP 상세가이드 개요 → 기안 링크(허브 구조)
await p.goto(`${BASE}/d/ERP 상세가이드 개요/`, { waitUntil: "networkidle" });
await p.waitForTimeout(800);
body = await p.textContent("body");
ok(body.includes("결재상신(기안)") || body.includes("전자결재 기안"), "6) 원업무 노트→기안 허브 링크 렌더");

await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 전자결재 기안 검증 통과");
process.exit(fails.length ? 1 : 0);
