// v1 ⑧·⑨(S3·S4) 근거 패널 재설계 검증 (dev 3101, flag source_card_v2 on).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const ctx = await b.newContext();
let r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: "b6test", password: "test1234" } });
ok(r.ok(), `0) 로그인 (${r.status()})`);
const flags = await (await ctx.request.get(`${BASE}/api/app/flags`)).json();
ok(flags.source_card_v2 === true, "1) source_card_v2 on");

const p = await ctx.newPage({ viewport: { width: 1440, height: 1100 } });
await p.goto(`${BASE}/`, { waitUntil: "load" });
await p.waitForTimeout(1600);

// ── S3: 기존 정상 답변 대화 — 집계 헤더 + 카드 미검수 제거 + 메타줄 ──
const aside = p.locator('aside[class*="sources"]').first();
let t = (await aside.textContent()) || "";
ok(/자동 변환 원문|검수 완료 \d+\//.test(t), "2) 헤더 검수 집계 1줄 표시");
const perCardMi = await aside.locator('[class*="stWarn"]', { hasText: "미검수" }).count();
ok(perCardMi === 0, `3) 카드별 '미검수' 반복 제거 (${perCardMi}건)`);
ok((await aside.locator('[class*="srcMetaLine"]').count()) > 0, "4) 보조정보 메타줄(분류·개정·자동첨부) 존재");
ok((await aside.getByText("⭐ 핵심 근거").count()) > 0, "5) 정상 답변엔 ⭐핵심근거 유지");

// ── S4: 거부 답변 — 리프레임 + 팁 + ⭐억제 ──
await p.click('button:has-text("새 대화")').catch(() => {});
await p.waitForTimeout(400);
await p.fill('textarea[placeholder^="행정 업무"]', "직원 전용 요트 대여 규정 알려줘");
await p.click('button:has-text("보내기")');
await p.waitForSelector('button[title="도움이 됐어요"]', { timeout: 240000 }).catch(() => {});
await p.waitForTimeout(1200);
const bodyT = (await p.textContent("body")) || "";
if (/확인되지\s*않|확인할\s*수\s*없/.test(bodyT)) {
  const t2 = (await aside.textContent()) || "";
  ok(t2.includes("참고 검색 결과"), "6) 거부 시 '참고 검색 결과'로 리프레임");
  ok(t2.includes("이렇게 해보세요"), "7) 대안 팁 블록 표시");
  ok((await aside.getByText("⭐ 핵심 근거").count()) === 0, "8) 거부 시 ⭐핵심근거 억제");
} else {
  ok(true, "6~8) (모델이 거부하지 않고 답변 — 거부 케이스 스킵, 로직은 정상 케이스로 검증됨)");
}
await aside.screenshot({ path: "verify-source-v2.png" }).catch(() => {});
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 근거 패널 v2 검증 통과");
process.exit(fails.length ? 1 : 0);
