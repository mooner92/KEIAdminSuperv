// 카드 경계 시인성 회귀(2026-08-03 실사용 지적: "어디까지가 한 콘텐츠인지 모르겠다").
// ⛔ 이 검사의 핵심은 "면 대비가 0이 아닐 것" — 카드 배경이 부모 패널과 같은 색이면
//    테두리 헤어라인 하나에만 의존하게 되고, 다크에서 그건 사실상 안 보인다(실측 원인).
// 실행: set -a; . tools/.test_credentials; set +a; cd web && node verify-card-contrast.mjs
import { chromium } from "playwright";
import { makeCheck } from "./verify-lib.mjs";

const TEST_USER = process.env.APP_TEST_USER || "b6test";
const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) {
  console.error("❌ APP_TEST_PASS 미설정 — 검증 계정 비밀번호는 환경변수로만 받습니다.");
  process.exit(2);
}
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const { check, finish } = makeCheck();
const lum = (rgb) => {
  const [r, g, b] = rgb.match(/\d+/g).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const browser = await chromium.launch();
for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, colorScheme: theme });
  await ctx.request.post(BASE + "/api/app/auth/login", { data: { username: TEST_USER, password: TEST_PW } });
  const p = await ctx.newPage();
  await p.goto(BASE + "/changelog/", { waitUntil: "load" });
  await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await p.waitForTimeout(800);

  const card = p.locator("article").first();
  const m = await card.evaluate((el) => {
    const cs = getComputedStyle(el), be = getComputedStyle(el, "::before");
    // 카드 뒤에서 실제로 칠해진 첫 조상(투명 배경은 건너뛴다 — 눈에 보이는 바탕이 기준)
    let n = el.parentElement, behind = "rgb(255, 255, 255)";
    while (n) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)") { behind = bg; break; }
      n = n.parentElement;
    }
    return { card: cs.backgroundColor, behind, border: cs.borderTopColor,
             shadow: cs.boxShadow, stripe: be.width, stripeOp: be.opacity };
  });
  // ① 분리 수단은 테마마다 다르다 — 임계값을 낮춰 통과시키는 게 아니라 물리가 다르다.
  //    다크: 옅은 그림자가 안 보인다(팔레트 주석에 명시) → **면 대비로만** 띄울 수 있다.
  //    라이트: 흰 카드가 천장이라 면 대비 여지가 없다 → 그림자가 분리를 담당한다(실렌더 확인).
  const d = Math.abs(lum(m.card) - lum(m.behind));
  const need = theme === "dark" ? 6 : 2;
  check(`[${theme}] ① 면 대비 — 카드가 뒤 바탕과 다른 밝기(≥${need})`, d >= need,
        `${m.card} vs ${m.behind} = ${d.toFixed(1)}`);
  const alpha = parseFloat((m.border.match(/([\d.]+)\)$/) || [, "1"])[1]);
  check(`[${theme}] ② 선 대비 — 헤어라인(.07)이 아닌 강한 테두리`, !m.border.includes("rgba") || alpha > 0.09,
        m.border);
  check(`[${theme}] ③ 그림자로 면을 띄움`, Boolean(m.shadow) && m.shadow !== "none", m.shadow.slice(0, 32));
  check(`[${theme}] ④ 좌측 스트라이프(카드 시작 앵커)`, m.stripe === "3px" && Number(m.stripeOp) > 0,
        `${m.stripe} / opacity ${m.stripeOp}`);

  // ⑤ 호버는 '보조 신호'다 — 정적 상태가 이미 통과한 뒤에만 의미가 있다
  await card.hover();
  await p.waitForTimeout(350);
  const hov = await card.evaluate((el) => getComputedStyle(el).borderTopColor);
  check(`[${theme}] ⑤ 호버 시 테두리 변화`, hov !== m.border, `${m.border} → ${hov}`);
  await ctx.close();
}
await browser.close();
finish("카드 경계 시인성(새로워진 점)");
