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

// Track A(조문 정제) 인덱스 — tools/index/{article_status,clause_xref,defterms}.json.
// 규정명별 슬라이스(삭제·신설 조문 / 준용·참조 / 정의어)를 문서 JSON에 부착 → 드로어가 별도 fetch 없이 렌더.
// 인덱스가 없으면(미생성) 조용히 건너뜀(빌드 실패 안 함).
const INDEX_DIR =
  process.env.INDEX_DIR || path.resolve(process.env.VAULT_DIR || ".", "..", "tools", "index");
const loadJson = (f: string): any => {
  try {
    return JSON.parse(fs.readFileSync(path.join(INDEX_DIR, f), "utf-8"));
  } catch {
    return null;
  }
};
const statusIdx = loadJson("article_status.json");
const xrefIdx = loadJson("clause_xref.json");
const defIdx = loadJson("defterms.json");
const gaIdx = loadJson("graph_analytics.json"); // Track C: 개정 파급·공동인용
const dlIdx = loadJson("deadlines.json"); // Track B: 상대기한
const apIdx = loadJson("approval.json"); // Track B: 위임전결(결재선)
let trackACount = 0;
let trackCCount = 0;
let deadlineCount = 0;

// 규정명 → slug (드로어는 slug로 로드하므로 참조/파급 칩 목적지를 slug로 해석; 없으면 비클릭)
const regSlug = new Map<string, string>();
const splitKey = (k: string): [string, string] => {
  const i = k.lastIndexOf("#");
  return i < 0 ? [k, ""] : [k.slice(0, i), k.slice(i + 1)];
};

function trackAFor(regName: string) {
  if (!regName) return null;
  const pfx = regName + "#";
  const deleted: { 조: string; 삭제일: string }[] = [];
  const added: { 조: string; 신설일: string }[] = [];
  const crossRefs: { from: string; toName: string; toSlug: string; toJo: string; rel: string }[] = [];
  const defs: { 조: string; term: string; 정의: string }[] = [];
  if (statusIdx?.articles) {
    for (const k of Object.keys(statusIdx.articles)) {
      if (!k.startsWith(pfx)) continue;
      const v = statusIdx.articles[k];
      const 조 = k.slice(pfx.length);
      if (v.status === "삭제") deleted.push({ 조, 삭제일: v.삭제일 || "" });
      if (v.신설) added.push({ 조, 신설일: v.신설일 || "" });
    }
  }
  if (xrefIdx?.edges) {
    for (const k of Object.keys(xrefIdx.edges)) {
      if (!k.startsWith(pfx)) continue;
      const from = k.slice(pfx.length);
      for (const e of xrefIdx.edges[k])
        if (e.scope === "cross") {
          const [toName, toJo] = splitKey(e.target);
          crossRefs.push({ from, toName, toSlug: regSlug.get(toName) || "", toJo, rel: e.rel });
        }
    }
  }
  if (defIdx?.terms) {
    for (const term of Object.keys(defIdx.terms)) {
      for (const d of defIdx.terms[term]) if (d.규정명 === regName) defs.push({ 조: d.조, term, 정의: d.정의 });
    }
  }
  if (!deleted.length && !added.length && !crossRefs.length && !defs.length) return null;
  trackACount++;
  return { deleted, added, crossRefs: crossRefs.slice(0, 40), defs: defs.slice(0, 40) };
}

// Track C(개정 파급·공동인용) 규정별 슬라이스 — graph_analytics.json(01l) 소비
function trackCFor(regName: string) {
  if (!regName || !gaIdx) return null;
  const pfx = regName + "#";
  const impactedBy = ((gaIdx.impact && gaIdx.impact[regName]) || [])
    .slice(0, 30)
    .map(([name, hop]: [string, number]) => ({ name, slug: regSlug.get(name) || "", hop }));
  // 함께 보는 조문: 이 규정 조문들의 공동인용 이웃(다른 규정 조문만) 누적 → 상위
  const acc: Record<string, number> = {};
  if (gaIdx.cocitation) {
    for (const key of Object.keys(gaIdx.cocitation)) {
      if (!key.startsWith(pfx)) continue;
      for (const [nbr, c] of gaIdx.cocitation[key]) {
        if (nbr.startsWith(pfx)) continue; // 같은 규정 제외 → 규정 간 '함께 보는'만
        acc[nbr] = (acc[nbr] || 0) + c;
      }
    }
  }
  const coCited = Object.entries(acc)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => {
      const [name, jo] = splitKey(key);
      return { name, slug: regSlug.get(name) || "", jo, count };
    });
  const isolated = Array.isArray(gaIdx.isolated) && gaIdx.isolated.includes(regName);
  if (!impactedBy.length && !coCited.length && !isolated) return null;
  trackCCount++;
  return { impactedBy, coCited, isolated };
}

const docs = getAllDocs();
for (const m of docs) if (m.section === "규정집" && !regSlug.has(m.title)) regSlug.set(m.title, m.slug);
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
  const trackA = meta.section === "규정집" ? trackAFor(doc.title) : null;
  const trackC = meta.section === "규정집" ? trackCFor(doc.title) : null;
  // Track B: 기한 슬라이스 — 계산 가능한 것 우선(마감·anchor 有), 상한 20
  let deadlines = null;
  if (meta.section === "규정집" && dlIdx?.deadlines?.[doc.title]) {
    const rows = dlIdx.deadlines[doc.title];
    rows.sort((a: any, b: any) => (b.anchor ? 1 : 0) - (a.anchor ? 1 : 0)); // anchor 있는 것 먼저
    deadlines = rows.slice(0, 20);
    if (deadlines.length) deadlineCount++;
  }
  fs.writeFileSync(
    path.join(OUT, `${meta.slug}.json`),
    JSON.stringify({ ...doc, backlinks, trackA, trackC, deadlines }),
    "utf-8",
  );
  searchIndex[meta.slug] = searchable(doc.body);
  n++;
}
console.log(`Track A: ${trackACount}개 · Track C: ${trackCCount}개 · 기한(B): ${deadlineCount}개 규정 슬라이스 (index=${INDEX_DIR})`);
// 결재선 판정기 독립 페이지(/approval)·채팅 드로어용 — 전결규칙 전체를 단일 파일로(lazy fetch)
if (apIdx?.rules?.length) {
  const apPath = path.resolve(process.cwd(), "out", "approval.json");
  fs.writeFileSync(apPath, JSON.stringify({ rules: apIdx.rules }), "utf-8");
  console.log(`approval: ${apIdx.rules.length}개 전결규칙 → ${apPath}`);
}

const idxPath = path.resolve(process.cwd(), "out", "search-index.json");
fs.writeFileSync(idxPath, JSON.stringify(searchIndex), "utf-8");
const kb = Math.round(fs.statSync(idxPath).size / 1024);
console.log(`docdata: ${n}개 문서 JSON → ${OUT}`);
console.log(`search-index: ${n}개 본문 → ${idxPath} (${kb}KB, 내용검색 lazy-load)`);
