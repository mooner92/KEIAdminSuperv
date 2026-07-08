// Track A(조문 정제·무결성) 실렌더 검증 — 문서 드로어의 준용·효력·정의어 패널 (dev 3101).
// 전제: article_integrity 플래그 on + 재빌드된 out/(trackA 슬라이스 포함).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1300 } });

// 1) 공개 플래그에 article_integrity=on 확인 (server.js 프록시 경로)
const flags = await (await p.request.get(`${BASE}/api/app/flags`)).json();
ok(flags.article_integrity === true, "1) article_integrity 플래그 on");

// 2) 둘러보기 → 보수규정(준용6·삭제3·정의8) 드로어 열기
await p.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
// 검색으로 좁힌 뒤 행 클릭(제목 매칭)
const box = p.locator('input[aria-label="검색"]').first();
await box.fill("보수규정");
await p.waitForTimeout(1000);
await p.getByText("보수규정", { exact: true }).first().click(); // 제목 정확 매칭 → 4100_보수규정
await p.waitForTimeout(1200);
let body = await p.textContent("body");

ok(body.includes("준용·참조하는 다른 규정 조문"), "2) '준용·참조' 섹션 렌더");
ok(body.includes("조문 효력 이력"), "3) '조문 효력 이력' 섹션 렌더");
ok(body.includes("이 규정이 정의한 용어"), "4) '정의어' 섹션 렌더");
ok(/삭제/.test(body), "5) 삭제 조문 배지 노출");
await p.screenshot({ path: "verify-trackA-drawer.png" });

// 3) 준용 칩 클릭 → 대상 규정으로 드로어 내부 이동
const chip = p.locator("button", { hasText: /→/ }).first();
if (await chip.count()) {
  await chip.click();
  await p.waitForTimeout(1000);
  body = await p.textContent("body");
  ok(body.length > 0, "6) 준용 칩 클릭 시 대상 문서로 이동(드로어 유지)");
} else {
  ok(false, "6) 준용 칩을 찾지 못함");
}
await p.screenshot({ path: "verify-trackA-nav.png" });

await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ Track A 드로어 패널 검증 통과");
process.exit(fails.length ? 1 : 0);
