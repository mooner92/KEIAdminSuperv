// verify-yeobi-note.mjs — dev(3101) 둘러보기에 여비 계산 노트가 실제 렌더되는지 확인
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:3101';
const TITLE = '국내출장 여비';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
await page.goto(`${BASE}/browse`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// 전체 페이지에서 노트 제목 존재 확인
const bodyText = await page.textContent('body');
const present = bodyText.includes(TITLE);
console.log('둘러보기 본문에 여비 노트 제목:', present ? '✅ 있음' : '❌ 없음');

// 노트 링크로 스크롤 시도(있으면)
let clickable = false;
try {
  const link = page.getByText(TITLE, { exact: false }).first();
  await link.scrollIntoViewIfNeeded({ timeout: 3000 });
  clickable = true;
} catch { /* 링크 형태가 아닐 수 있음 */ }
console.log('노트 링크 스크롤:', clickable ? '✅ 됨' : '(스킵)');

await page.screenshot({ path: 'yeobi-note-browse.png', fullPage: true });
console.log('스크린샷 저장: web/yeobi-note-browse.png');

// 문서 페이지도 열어 드로어/본문 렌더 확인
await page.goto(`${BASE}/d/국내출장여비계산/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
const docText = await page.textContent('body');
console.log('문서 페이지에 별표2 실제 값(25,000) 렌더:', docText.includes('25,000') ? '✅' : '(확인 필요)');
await page.screenshot({ path: 'yeobi-note-doc.png' });
console.log('스크린샷 저장: web/yeobi-note-doc.png');

await browser.close();
