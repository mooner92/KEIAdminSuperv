// 기능 플래그 end-to-end 실렌더 검증: 게이트 → 관리자 토글(행 특정·원상복구) → 노출 ON/OFF.
// 2026-07-14 재작성: demo_banner 제거(docs/32)로 스테일 → changelog 플래그·dev(3101) 기준.
// 실행 전 상태를 기억해 끝나면 원상복구한다(dev DB 부수효과 없음).
import { chromium } from "playwright";
const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const FLAG = "changelog";
const b = await chromium.launch();
const fails = [];
const ok = (c, m) => { console.log((c ? "✅" : "❌") + " " + m); if (!c) fails.push(m); };

// 0) API로 초기 상태 확인(끝나고 복구용)
const ctx = await b.newContext();
await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "admintest", password: "admtest123" } });
const before = await (await ctx.request.get(`${BASE}/api/app/flags`)).json();
const initial = !!(before.flags ? before.flags[FLAG] : before[FLAG]);
console.log(`초기 ${FLAG}=${initial}`);

// 1) 로그아웃 상태 /admin → 게이트
const anon = await (await b.newContext()).newPage();
await anon.goto(`${BASE}/admin/`, { waitUntil: "load" });
await anon.waitForTimeout(1500);
const anonBody = await anon.innerText("body");
ok(anonBody.includes("관리자 전용") || anonBody.includes("로그인이 필요"), "1) 로그아웃 /admin 게이트");

// 2) 관리자: /admin/#flags 에서 해당 플래그 행 스위치 확인
const p = await ctx.newPage();
await p.goto(`${BASE}/admin/#flags`, { waitUntil: "load" });
await p.waitForTimeout(1800);
ok((await p.innerText("body")).includes(FLAG), `2) 플래그 목록에 ${FLAG} 표시`);
const row = p.locator(`text=${FLAG}`).locator("xpath=ancestor::*[.//*[@role='switch']][1]");
const sw = row.locator('[role="switch"]').first();
ok((await sw.count()) === 1, "2b) 플래그 행 스위치 존재(행 특정 — 맹목 첫 스위치 클릭 금지)");

// 3) OFF 토글 → 노출 없음 / ON 토글 → 푸터 링크 노출(배너는 닫음 기억이 있어 푸터로 판정)
const setFlag = async (want) => {
  const cur = (await sw.getAttribute("aria-checked")) === "true";
  if (cur !== want) { await sw.click(); await p.waitForTimeout(700); }
};
await setFlag(false);
const off = await ctx.newPage();
await off.goto(`${BASE}/browse/`, { waitUntil: "load" });
await off.waitForTimeout(1500);
ok(!(await off.innerText("body")).includes("새로워진 점"), "3) OFF: 배너·푸터 링크 미노출");
await setFlag(true);
const on = await ctx.newPage();
await on.goto(`${BASE}/browse/`, { waitUntil: "load" });
await on.waitForTimeout(1500);
ok((await on.innerText("footer")).includes("새로워진 점"), "4) ON: 푸터 링크 노출");

// 5) 원상복구
await setFlag(initial);
console.log(`복구: ${FLAG}=${initial}`);

console.log(fails.length ? `\n❌ ${fails.join(" / ")}` : "\n✅ 기능 플래그 end-to-end 통과");
await b.close();
process.exit(fails.length ? 1 : 0);
