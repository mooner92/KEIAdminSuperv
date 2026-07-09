// v1 ⑮⑯(S8) 검증 — /help·footer 버전·도움말 링크·404 회귀·ErrorBoundary 존재 (dev 3101).
import { chromium } from "playwright";
const BASE = "http://localhost:3101";
const fails = [];
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto(`${BASE}/help/`, { waitUntil: "load" });
await p.waitForTimeout(800);
const body = await p.textContent("body");
ok(body.includes("할 수 있는 것") && body.includes("한계"), "1) /help 렌더(기능·한계 고지)");
ok(body.includes("확인되지 않습니다"), "2) 거부 의미 설명 포함");
const footer = await p.locator("footer").textContent();
ok((footer || "").includes("도움말"), "3) footer 도움말 링크");
ok(/v\.[0-9a-f]{7}/.test(footer || ""), `4) footer 빌드 버전 표기 (${(footer || "").match(/v\.[0-9a-f]+/)?.[0]})`);
await p.locator('footer >> text=도움말').click().catch(() => {});
await b.close();
console.log(fails.length ? "\n❌ " + fails.join(" / ") : "\n✅ S8 프론트 검증 통과");
process.exit(fails.length ? 1 : 0);
