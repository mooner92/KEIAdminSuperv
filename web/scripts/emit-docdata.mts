/**
 * emit-docdata.ts — 빌드타임 산출물: 문서별 JSON.
 *
 * Notion형 문서 드로어(DocDrawer)가 목록/그래프/근거카드를 클릭했을 때
 * 페이지 이동 없이 본문을 "지연 로드"하기 위해, 각 문서를 out/docdata/<slug>.json 으로 뽑는다.
 *
 * vault.ts의 로직(위키링크 해석·메타 추출)을 그대로 재사용한다(Node 22 --experimental-strip-types).
 * → 페이지 SSG와 드로어가 동일한 본문/링크를 보장(로직 드리프트 없음).
 *
 * 실행: package.json "build"가 `next build` 뒤에 자동 호출.
 *   node --experimental-strip-types scripts/emit-docdata.ts   (cwd=web, VAULT_DIR 필요)
 */
import fs from "node:fs";
import path from "node:path";
import { getAllDocs, getDoc, getBacklinks } from "../lib/vault.ts";

const OUT = path.resolve(process.cwd(), "out", "docdata");
fs.mkdirSync(OUT, { recursive: true });

// 원문 내용 검색용 정규화: 마크다운/링크/표기호 제거 → 소문자(한글은 불변) 평문.
// content_search 켤 때만 lazy fetch되는 단일 파일이라 browse 번들을 비대화하지 않음.
function searchable(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // 코드블록
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // 이미지
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 링크 → 표시텍스트
    .replace(/<[^>]+>/g, " ") // html/콜아웃 태그
    .replace(/[#>*_`~|]+/g, " ") // 마크다운 기호
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const docs = getAllDocs();
const searchIndex: Record<string, string> = {};
let n = 0;
for (const meta of docs) {
  const doc = getDoc(meta.slug);
  if (!doc) continue;
  const backlinks = getBacklinks(meta.slug).map((b) => ({
    slug: b.slug,
    title: b.title,
    section: b.section,
  }));
  fs.writeFileSync(path.join(OUT, `${meta.slug}.json`), JSON.stringify({ ...doc, backlinks }), "utf-8");
  searchIndex[meta.slug] = searchable(doc.body);
  n++;
}
const idxPath = path.resolve(process.cwd(), "out", "search-index.json");
fs.writeFileSync(idxPath, JSON.stringify(searchIndex), "utf-8");
const kb = Math.round(fs.statSync(idxPath).size / 1024);
console.log(`docdata: ${n}개 문서 JSON → ${OUT}`);
console.log(`search-index: ${n}개 본문 → ${idxPath} (${kb}KB, 내용검색 lazy-load)`);
