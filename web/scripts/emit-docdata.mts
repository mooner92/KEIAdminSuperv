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

const docs = getAllDocs();
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
  n++;
}
console.log(`docdata: ${n}개 문서 JSON → ${OUT}`);
