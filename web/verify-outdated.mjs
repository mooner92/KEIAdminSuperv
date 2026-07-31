// docs/28 실렌더 검증 — 취소선(옛값)·복원 표·구판 배너가 문서 페이지(/d/)에 실제로 보이는지.
// 실행: cd web && node verify-outdated.mjs   (dev 3101 + 재빌드된 out/ 필요)
import { chromium } from "playwright";

const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
import { makeCheck } from "./verify-lib.mjs";
const { check, finish } = makeCheck();

async function openDoc(slug) {
  await p.goto(`${BASE}/d/${encodeURIComponent(slug)}/`, { waitUntil: "load" });
  await p.waitForTimeout(1800);
  return p.evaluate(() => {
    const dels = Array.from(document.querySelectorAll("del, s")).map((d) => (d.textContent || "").trim());
    const rows = Array.from(document.querySelectorAll("table tr")).map((tr) =>
      Array.from(tr.querySelectorAll("th,td")).map((c) => (c.textContent || "").trim())
    );
    // 취소선 실렌더(픽셀 아닌 계산 스타일) 확인 — <del>의 text-decoration
    const decos = Array.from(document.querySelectorAll("del, s")).slice(0, 3)
      .map((el) => getComputedStyle(el).textDecorationLine);
    return { text: document.body.innerText || "", dels, rows, decos };
  });
}

// ① 신입길라잡이 — 옛값 취소선 렌더(<del>) + 현행값 병기
{
  const d = await openDoc("2024년신입직원을위한KEI길라잡이");
  check("① 취소선(<del>) 렌더", d.dels.length >= 3, `del ${d.dels.length}개: ${d.dels.slice(0, 4).join(", ")}`);
  check("① 취소선 스타일 line-through", d.decos.every((x) => x.includes("line-through")), d.decos.join(","));
  check("① 옛값 50만원 취소선 처리", d.dels.some((t) => t.includes("50만원")));
  check("① 현행 100만원 병기", d.text.includes("100만원"));
  check("① 음식물 3만→5만", d.dels.some((t) => t === "3만원") && d.text.includes("5만원"));
  await p.screenshot({ path: "verify-outdated-guide.png" });
}

// ② 상조회규약 — 경조금 표 행 분리(결혼 행에 500,000원이 같은 행 셀로)
{
  const d = await openDoc("상조회규약");
  const marriage = d.rows.find((r) => r[0] === "결혼");
  check("② 경조금 표 행 분리(결혼 행)", !!marriage && (marriage[1] || "").includes("500,000원"),
    JSON.stringify((marriage || []).slice(0, 2)));
  const merged = d.rows.find((r) => (r[0] || "").includes("결혼") && (r[0] || "").includes("퇴직"));
  check("② 병합 셀 잔존 없음", !merged);
  await p.screenshot({ path: "verify-outdated-table.png" });
}

// ③ 위탁연구계약관리기준(구판) — 배너 노출 + 현행 안내
{
  const d = await openDoc("위탁연구계약관리기준");
  check("③ 구판 배너 노출", d.text.includes("구판 문서"));
  check("③ 현행 문서 안내", d.text.includes("위탁연구사업 계약업무 기준"));
  await p.screenshot({ path: "verify-outdated-banner.png" });
}


// ④ 렌더 위생 — 주석·<br> 문자가 화면에 노출되지 않아야 한다 (docs/28 렌더 수정)
{
  const d = await openDoc("상조회규약");
  check("④ '<br>' 문자 미노출", !d.text.includes("<br>"));
  check("④ outdated 주석 미노출", !d.text.includes("outdated") && !d.text.includes("<!--"));
  const death = d.rows.find((r) => r[0] === "사망");
  check("④ 사망 행 다항 금액 유지", !!death && (death[1] || "").includes("3,000,000원") && (death[1] || "").includes("1,000,000원"));
  const g = await openDoc("2024년신입직원을위한KEI길라잡이");
  check("④ 길라잡이 주석 미노출", !g.text.includes("outdated") && !g.text.includes("<!--"));
}

await b.close();
process.exit(finish());
