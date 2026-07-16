// 둘러보기 원문 내용 검색(content_search) 실렌더 검증 (dev 3101).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
await p.context().request.post(BASE + "/api/app/auth/login", { data: { username: "admintest", password: "admtest123" } }); // docs/44 게이트

await p.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
await p.waitForTimeout(1500); // 플래그 fetch + scope 반영 대기

const searchInput = p.locator('[class*="searchWrap"] input').first();
const scopeChip = (label) => p.locator('[class*="scopeRow"] button').filter({ hasText: label }).first();

// 1) 범위 선택 UI + 기본 제목+내용
ok(await p.getByText("검색 범위", { exact: false }).count() > 0, "1) 검색 범위 선택 UI 노출");
ok((await scopeChip("내용").getAttribute("aria-pressed")) === "true", "2) 기본 범위에 '내용' 포함");
ok((await scopeChip("제목").getAttribute("aria-pressed")) === "true", "3) 기본 범위에 '제목' 포함");
ok((await scopeChip("규정번호").getAttribute("aria-pressed")) === "false", "3b) 기본 범위에 '규정번호' 미포함");

async function count(term) {
  await searchInput.fill(term);
  await p.waitForTimeout(700);
  const t = await p.locator('[class*="count"]').first().textContent();
  const m = (t || "").match(/(\d+)건/);
  return m ? parseInt(m[1]) : -1;
}

// 2) 본문에만 있는 용어(제목 아님) → 내용검색 결과 + 스니펫
const n1 = await count("기록물등록대장");
ok(n1 >= 1, `4) 본문 전용어 '기록물등록대장' 내용검색 → ${n1}건`);
ok((await p.locator('[class*="snippet"]').count()) >= 1, "5) 내용 매칭 스니펫 미리보기 노출");
await p.screenshot({ path: "verify-content-search.png", fullPage: false });

// 3) '내용' 범위 끄면 제목전용 → 0건
await searchInput.fill("");
await p.waitForTimeout(300);
await scopeChip("내용").click();
await p.waitForTimeout(300);
ok((await scopeChip("내용").getAttribute("aria-pressed")) === "false", "6) '내용' 범위 토글 off");
const n2 = await count("기록물등록대장");
ok(n2 === 0, `7) 내용 끄면 제목전용 매칭 → ${n2}건(0 기대)`);

await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 원문 내용 검색 검증 통과");
process.exit(fails.length ? 1 : 0);
