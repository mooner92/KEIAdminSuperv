// v1 스펙 B2(날짜 렌더)·B3(IME 가드)·B5(로그인 안내) 실렌더 검증 (dev 3101).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage({ viewport: { width: 1440, height: 1200 } });

// ── B2: 둘러보기 행·드로어 날짜가 YYYY-MM-DD ──
await p.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
let body = await p.textContent("body");
ok(!body.includes("GMT+0900"), "B2-1) 둘러보기에 원시 Date 문자열 없음");
ok(/\d{4}-\d{2}-\d{2}/.test(body), "B2-2) YYYY-MM-DD 형식 날짜 렌더");
await p.locator('input[aria-label="검색"]').first().fill("직제규정");
await p.waitForTimeout(900);
await p.getByText("직제규정", { exact: true }).first().click();
await p.waitForTimeout(1200);
const drawerTxt = await p.locator('[aria-label="문서 보기"]').textContent();
ok(!drawerTxt.includes("GMT+0900") && /개정 \d{4}-\d{2}-\d{2}/.test(drawerTxt), "B2-3) 드로어 헤더 개정일 정상");
await p.keyboard.press("Escape");

// ── B5: 로그인 화면 비밀번호 문의 안내 ──
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(1000);
body = await p.textContent("body");
ok(body.includes("비밀번호를 잊으셨나요"), "B5) 로그인 화면 재설정 문의 안내");

// ── B3: IME 가드 — 로그인 후 조합 중 Enter는 전송 안 됨 ──
let r = await ctx.request.post(`${BASE}/api/app/auth/register`, { data: { username: "imetest", password: "test1234" } });
if (!r.ok()) r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "imetest", password: "test1234" } });
ok(r.ok(), `B3-0) 로그인 (${r.status()})`);
await p.reload({ waitUntil: "load" });
await p.waitForTimeout(1200);
await p.click('button:has-text("새 대화")').catch(() => {});
await p.waitForTimeout(400);
const ta = p.locator('textarea[placeholder^="행정 업무"]');
await ta.fill("조합 테스트");
// 조합 중 Enter 시뮬레이트: keyCode 229 (React는 e.keyCode를 그대로 노출)
await ta.evaluate((el) => {
  const ev = new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true });
  Object.defineProperty(ev, "keyCode", { get: () => 229 });
  el.dispatchEvent(ev);
});
await p.waitForTimeout(600);
// send()는 성공 시 입력을 비우므로, 입력이 그대로면 전송이 차단된 것(가드 동작 증거)
const taVal = await ta.inputValue();
const sendingBtn = await p.locator('button:has-text("보내는 중")').count(); // 전송 시작 흔적도 없어야
ok(taVal === "조합 테스트" && sendingBtn === 0, `B3-1) 조합 중 Enter(keyCode 229) 전송 차단 (입력 유지: "${taVal}")`);
// 일반 Enter는 전송됨(사용자 말풍선 등장 — LLM 완료는 기다리지 않음)
await ta.press("Enter");
await p.waitForSelector('main >> text=조합 테스트', { timeout: 8000 }).then(() => ok(true, "B3-2) 일반 Enter는 정상 전송")).catch(() => ok(false, "B3-2) 일반 Enter 전송 실패"));

await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ B2·B3·B5 검증 통과");
process.exit(fails.length ? 1 : 0);
