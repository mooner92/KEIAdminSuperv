// 문서 드로어 실렌더 검증 — 사용자 보고("문서를 불러오지 못했습니다") 재현/해결 확인.
import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
const errs = [];
p.on("requestfailed", (r) => { if (r.url().includes("/docdata/")) errs.push("REQFAIL " + r.url()); });
await p.goto("http://localhost:3100/browse/", { waitUntil: "load" });
await p.waitForTimeout(1500);
// 첫 문서 행 클릭
await p.evaluate(() => {
  // 실제 행: <button className={styles.row}> — 제목+칩+'개 조문' 텍스트가 들어있는 버튼
  const btn = Array.from(document.querySelectorAll("button")).find(
    (b) => /개 조문|규정집|정부출연|정관/.test(b.textContent || "") && (b.textContent || "").length > 12
  );
  btn?.click();
});
await p.waitForTimeout(2500);
const state = await p.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]') || document.body;
  const t = dlg.textContent || "";
  return {
    failed: t.includes("불러오지 못했습니다"),
    hasHeading: !!dlg.querySelector("h1, h2"),
    head: (dlg.querySelector("h1, h2")?.textContent || "").slice(0, 40),
    bodyLen: t.length,
  };
});
console.log("드로어 상태:", JSON.stringify(state));
console.log("docdata 요청 실패:", errs.length ? errs : "없음");
await p.screenshot({ path: "verify-drawer.png", fullPage: false });
const ok = !state.failed && state.hasHeading && errs.length === 0;
console.log(ok ? "✅ 드로어 정상 로드" : "❌ 여전히 실패");
await b.close();
process.exit(ok ? 0 : 1);
