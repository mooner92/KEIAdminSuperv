// ERP 상세가이드 적재 + 메뉴↔상세 교차링크 실렌더 검증 (dev 3101).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1300 } });

// 1) 둘러보기: 상세가이드 노트 노출(사내 시스템 · 행정관리(ERP))
await p.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
let body = await p.textContent("body");
ok(body.includes("상세가이드"), "1) 둘러보기에 'ERP 상세가이드' 노트 노출");

// 2) 상세가이드 문서 페이지: 신청법 상세 렌더 + 역링크
await p.goto(`${BASE}/d/ERP 상세가이드 · 일반·총무(GEN)/`, { waitUntil: "networkidle" });
await p.waitForTimeout(900);
body = await p.textContent("body");
ok(body.includes("국내출장신청상세") && body.includes("gen_0021P"), "2) 상세가이드 본문 렌더(화면·화면ID)");
ok(body.includes("유류비정산안내") || body.includes("필수"), "3) 신청 방법 상세(필수입력/버튼) 렌더");
ok(body.includes("관련 메뉴 노트"), "4) 상세가이드→메뉴 역링크 섹션 렌더");
await p.screenshot({ path: "verify-deepguide-doc.png" });

// 3) 메뉴 노트 페이지: 상세 신청 가이드 링크
await p.goto(`${BASE}/d/ERP 시스템 · 복무관리/`, { waitUntil: "networkidle" });
await p.waitForTimeout(900);
body = await p.textContent("body");
ok(body.includes("상세 신청 가이드"), "5) 메뉴 노트에 '상세 신청 가이드' 섹션 렌더");

await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ ERP 상세가이드 검증 통과");
process.exit(fails.length ? 1 : 0);
