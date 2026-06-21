// #5 운영자 대시보드 실렌더 검증: 관리자 /admin → 대시보드 카드 + 인기질문 + 콘텐츠 갭 + 플래그 공존.
import { chromium } from "playwright";

const BASE = "http://localhost:3100";
const USER = "fb_test"; // 검증 동안 임시로 APP_ADMINS에 포함시켜 관리자로 만든다(검증 후 원복)
const PW = "test1234";
const fails = [];
const ok = (c, m) => {
  console.log((c ? "✅ " : "❌ ") + m);
  if (!c) fails.push(m);
};

const b = await chromium.launch();
const ctx = await b.newContext();
let r = await ctx.request.post(`${BASE}/api/app/auth/register`, { data: { username: USER, password: PW } });
if (r.status() === 409) r = await ctx.request.post(`${BASE}/api/app/auth/login`, { data: { username: USER, password: PW } });
ok(r.ok(), `0) 로그인 (${r.status()})`);

const p = await ctx.newPage();
await p.goto(`${BASE}/admin/`, { waitUntil: "load" });
// 대시보드는 flagsManage 성공 후 stats를 체이닝 fetch → 등장까지 auto-wait
await p.waitForSelector("text=운영 대시보드", { timeout: 15000 }).catch(() => {});
await p.waitForTimeout(500);

ok((await p.locator("text=운영 대시보드").count()) > 0, "1) 운영 대시보드 제목");
ok((await p.locator("text=거부율").count()) > 0, "2) 거부율 카드");
ok((await p.locator("text=피드백").count()) > 0, "3) 피드백 카드");
ok((await p.locator("text=인기 질문").count()) > 0, "4) 인기 질문 섹션");
ok((await p.locator("text=콘텐츠 갭").count()) > 0, "5) 콘텐츠 갭 섹션");
ok((await p.locator("text=기능 플래그 관리").count()) > 0, "6) 기능 플래그 섹션 공존");

await p.screenshot({ path: "verify-dashboard.png", fullPage: true });
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ 운영 대시보드 검증 통과");
process.exit(fails.length ? 1 : 0);
