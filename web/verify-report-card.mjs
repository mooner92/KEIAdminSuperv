// 오늘의 분석서 카드(specs/12 T02) 실렌더 검증 — 게시판에서 분석서가 읽히는가.
// ⛔ 핵심 계약: 분석서가 없는 날에도 게시판이 정상이어야 한다(카드만 사라진다).
// 실행: set -a; . tools/.test_credentials; set +a; cd web && node verify-report-card.mjs
import { chromium } from "playwright";
import { makeCheck } from "./verify-lib.mjs";

const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) { console.error("❌ APP_TEST_PASS 미설정"); process.exit(2); }
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const { check, finish } = makeCheck();

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1200, height: 1000 } });
await ctx.request.post(BASE + "/api/app/auth/login",
  { data: { username: process.env.APP_TEST_USER || "b6test", password: TEST_PW } });
await ctx.request.post(BASE + "/api/app/flags/quality_board", { data: { enabled: true } });
const p = await ctx.newPage();
await p.goto(BASE + "/quality/", { waitUntil: "load" });
await p.waitForTimeout(1800);

const card = p.locator("section", { hasText: "오늘의 분석서" }).last();
check("① 분석서 카드 노출", (await card.count()) > 0);
const txt = await card.innerText();
check("② 두 갈래 분리 — 수술 대기와 측정 노이즈", txt.includes("수술 대기") && txt.includes("측정 노이즈"),
      txt.split("\n").slice(0, 6).join(" / "));
check("③ 행동 후보가 근거 수치를 달고 있음", /\d/.test(txt) && txt.includes("건"));
const link = card.locator('a[href*="/quality/reports/"]');
check("④ 전문(.md) 링크", (await link.count()) === 1, await link.getAttribute("href"));

// ⑤ 분석서가 없는 날 — 카드만 사라지고 게시판은 살아 있어야 한다.
// ⚠ ?date=존재하지않는날 로는 검증할 수 없다 — 페이지가 최신일로 폴백해 분석서가 그대로 뜬다
//    (첫 시도가 이 때문에 실패했다). 분석서 요청만 404로 가로채는 것이 계약을 직접 겨냥한다.
const p2 = await ctx.newPage();
await p2.route("**/quality/reports/*.json", (route) => route.fulfill({ status: 404, body: "" }));
await p2.goto(BASE + "/quality/", { waitUntil: "load" });
await p2.waitForTimeout(1800);
const body = await p2.locator("body").innerText();
check("⑤ 분석서 없으면 카드만 사라지고 게시판은 정상",
      !body.includes("오늘의 분석서") && body.includes("정답률"),
      `본문 ${body.length}자`);
await b.close();
finish("오늘의 분석서 카드");
