// 여정 신선도 배지(specs/13 T01b) 실렌더 검증.
// ⛔ 핵심 계약 셋: ⓐ 플래그 off면 안 보인다 ⓑ 이상 있는 여정에만 뜬다(전 여정 배너 금지)
//                 ⓒ 문구가 단정하지 않는다("달라졌을 수 있다" — 과장 경보 금지)
// 실행: set -a; . tools/.test_credentials; set +a; cd web && node verify-journey-freshness.mjs
import { chromium } from "playwright";
import { makeCheck } from "./verify-lib.mjs";
import fs from "fs";

const TEST_PW = process.env.APP_TEST_PASS;
if (!TEST_PW) { console.error("❌ APP_TEST_PASS 미설정"); process.exit(2); }
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const ADMIN = process.env.APP_TEST_USER || "b6test";
const { check, finish } = makeCheck();

// 인덱스에서 '이상 있는 여정 / 없는 여정'을 실데이터로 뽑아 대조한다(하드코딩 금지 — 드리프트 방지)
const idx = JSON.parse(fs.readFileSync("../tools/index/journey_freshness.json", "utf-8"));
const dirty = Object.keys(idx.여정별 || {});
check("⓪ 인덱스에 이상 여정 존재(검증 전제)", dirty.length > 0, `${dirty.length}종: ${dirty.join(",")}`);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.request.post(BASE + "/api/app/auth/login", { data: { username: ADMIN, password: TEST_PW } });
// ⚠ 플래그 토글은 **관리자 전용**이라 픽스처 계정으로 부르면 403이 조용히 무시된다
//    (2026-08-03 실측: 이 검증이 그렇게 3건 거짓 실패했다 — 기능은 멀쩡했는데 토글이 안 먹었다).
//    그래서 이 검증은 토글하지 않는다: on 상태는 서버 실값으로 확인하고, off 상태는 응답을
//    가로채 만든다. 권한 없이도 두 상태를 모두 검증할 수 있고, 남의 dev 설정을 바꾸지도 않는다.
const flags = await (await ctx.request.get(`${BASE}/api/app/flags`)).json();
check("⓪-2 전제 — journey_map·journey_freshness 서버 on", flags.journey_map && flags.journey_freshness,
      `journey_map=${flags.journey_map} journey_freshness=${flags.journey_freshness}`);

// ⓐ 플래그 off(가로채기) — 배지 없음
let p = await ctx.newPage();
await p.route("**/app/flags", async (route) => {
  const res = await route.fetch();
  route.fulfill({ response: res, json: { ...(await res.json()), journey_freshness: false } });
});
await p.goto(`${BASE}/journey/?task=${dirty[0]}`, { waitUntil: "load" });
await p.waitForTimeout(1800);
check("① 플래그 off면 신선도 알림 미노출", !(await p.locator('[aria-label="여정 신선도 안내"]').count()));
await p.close();

// ⓑ 플래그 on(서버 실값) — 이상 있는 여정에는 뜬다
p = await ctx.newPage();
await p.goto(`${BASE}/journey/?task=${dirty[0]}`, { waitUntil: "load" });
await p.waitForTimeout(1800);
const note = p.locator('[aria-label="여정 신선도 안내"]');
check("② 이상 있는 여정에 알림 노출", (await note.count()) === 1, dirty[0]);
const txt = (await note.count()) ? await note.innerText() : "";
check("③ 근거 규정·조와 사유를 함께 제시", /제\d+조|별표/.test(txt) && txt.includes("개정"),
      txt.split("\n").slice(0, 4).join(" / "));
check("④ 단정하지 않는 문구(과장 경보 금지)", txt.includes("있어요") && !txt.includes("틀렸"));

// ⓒ 이상 없는 여정에는 안 뜬다 — 전 여정 배너는 경보를 무의미하게 만든다
const clean = await p.evaluate(() =>
  Array.from(document.querySelectorAll('[role="tab"]')).map((b) => b.textContent.trim()));
const cleanIdx = clean.findIndex((t) => !dirty.some((d) => t.includes(d)));
if (cleanIdx >= 0) {
  await p.locator('[role="tab"]').nth(cleanIdx).click();
  await p.waitForTimeout(600);
  check("⑤ 이상 없는 여정엔 미노출", !(await note.count()), clean[cleanIdx]);
} else {
  check("⑤ 이상 없는 여정엔 미노출", false, "정상 여정을 찾지 못함(전 여정이 이상)");
}

// ⓓ 근거 조문을 **누르면 열려야** 한다. 알림이 "원문을 열어 확인하라"고 말하면서 열 수단이
//   없으면 사람은 검색으로 되돌아간다 — 안내와 수단이 같은 자리에 있어야 한다.
await p.goto(`${BASE}/journey/?task=${dirty[0]}`, { waitUntil: "load" });
await p.waitForTimeout(1800);
const basis = note.locator("button");
check("⑥ 근거 조문이 누를 수 있는 버튼", (await basis.count()) > 0, `${await basis.count()}개`);
if (await basis.count()) {
  const label = (await basis.first().innerText()).trim();
  await basis.first().click();
  await p.waitForTimeout(1600);
  const opened = await p.evaluate(() =>
    !!document.querySelector("[class*='drawer'],[class*='Drawer']"));
  check("⑦ 클릭하면 문서 드로어가 열린다", opened, label);
  await p.screenshot({ path: "verify-journey-freshness-drawer.png" });
}
await b.close();
finish("여정 신선도 배지");
