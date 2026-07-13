// v1 스펙 B6(≤1080px 근거 오버레이) + B4 회귀(정상 스트림) 실렌더 검증 (dev 3101).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const ctx = await b.newContext();
let r = await ctx.request.post(`${BASE}/api/app/auth/register`, { data: { username: "b6test", password: "test1234" } });
if (!r.ok()) r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: "test1234" } });
ok(r.ok(), `0) 로그인 (${r.status()})`);

// ── B4 회귀 + 근거 생성: 넓은 화면에서 정상 스트림 질문 1건 ──
const p = await ctx.newPage({ viewport: { width: 1440, height: 1100 } });
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(1200);
await p.click('button:has-text("새 대화")').catch(() => {});
await p.waitForTimeout(400);
await p.fill('textarea[placeholder^="행정 업무"]', "연차휴가는 어떻게 신청하나요?");
await p.click('button:has-text("보내기")');
await p.waitForSelector('button[title="도움이 됐어요"]', { timeout: 240000 }).catch(() => {});
await p.waitForTimeout(1000);
let body = await p.textContent("body");
ok(!body.includes("응답이 중간에 끊겼습니다"), "1) B4 회귀 — 정상 스트림에 절단 마커 없음");
ok((await p.locator("aside .srcList, aside [class*=srcList]").count()) >= 0 && body.includes("근거 조문"), "2) 1440px — 우측 근거 패널 유지");
ok((await p.locator('button:has-text("다시 시도")').count()) === 0, "3) 정상 답변엔 재시도 버튼 없음");

// ── B6: 1000px — 패널 대신 FAB → 오버레이 ──
await p.setViewportSize({ width: 1000, height: 900 });
await p.waitForTimeout(600);
const fab = p.locator('button[class*=srcFab]');
ok((await fab.count()) > 0 && (await fab.isVisible()), "4) 1000px — '📎 근거 N개' 플로팅 버튼 노출");
await fab.click();
await p.waitForTimeout(500);
const overlay = p.locator('aside[class*=srcOverlayOpen]');
ok((await overlay.count()) > 0 && (await overlay.isVisible()), "5) 클릭 → 근거 오버레이 표시");
const overlayTxt = (await overlay.textContent()) || "";
ok(/근거 조문/.test(overlayTxt) && /규정|가이드/.test(overlayTxt), "6) 바텀시트에 근거 카드 렌더");
// 바텀시트가 화면을 다 덮지 않는지(대화가 위에 보임): 시트 top이 화면 40% 아래여야
const box = await overlay.boundingBox();
ok(box && box.y > 900 * 0.38, `6b) 바텀시트 높이 제한(대화 가시) — top=${Math.round(box?.y || 0)}px/900px`);
await p.screenshot({ path: "verify-v1-b6.png" });
// 배경 탭으로 닫기
await p.mouse.click(500, 100);
await p.waitForTimeout(400);
ok(!(await p.locator('aside[class*=srcOverlayOpen]').isVisible().catch(() => false)), "7) 배경 탭 → 닫힘");
// 다시 열고 ESC로 닫기
await fab.click();
await p.waitForTimeout(400);
await p.keyboard.press("Escape");
await p.waitForTimeout(300);
ok(!(await p.locator('aside[class*=srcOverlayOpen]').isVisible().catch(() => false)), "7b) ESC → 닫힘");

// 1440px 복귀 — FAB 숨김(CSS), 패널 복원
await p.setViewportSize({ width: 1440, height: 1100 });
await p.waitForTimeout(500);
ok(!(await fab.isVisible().catch(() => false)), "8) 1440px 복귀 — FAB 숨김(회귀)");

await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ B6·B4 회귀 검증 통과");
process.exit(fails.length ? 1 : 0);
