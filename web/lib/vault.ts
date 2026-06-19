// 볼트(KEI-행정가이드/) 읽기 — 빌드타임(SSG)에서만 동작. 볼트는 git 비추적(Syncthing 동기화).
// 환경변수 VAULT_DIR 로 경로 지정 가능(기본: 레포 루트의 KEI-행정가이드).
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export const VAULT_DIR =
  process.env.VAULT_DIR || path.resolve(process.cwd(), "..", "KEI-행정가이드");

// 섹션(통합 단일 앱, 화면 내 분리)
export const SECTIONS = {
  규정집: { dir: "20_규정원문", label: "규정집", desc: "KEI 규정 원문(제N조 단위)" },
  가이드: { dir: "10_업무가이드", label: "연구행정 가이드", desc: "업무 단위 쉬운 설명" },
  용어집: { dir: "30_용어집", label: "용어집", desc: "개념 사전" },
} as const;
export type SectionKey = keyof typeof SECTIONS;

export type DocMeta = {
  slug: string; // = 파일 stem (라우트 id)
  title: string;
  section: SectionKey;
  category: string; // 분류 폴더(예: 3000_인사)
  regNo: string; // 규정번호
  revised: string; // 개정일
  reviewed: string; // 검수상태
  type: string;
  articleCount: number;
};
export type Doc = DocMeta & { body: string };

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "_templates") continue;
      out.push(...walk(p));
    } else if (e.name.endsWith(".md") && e.name !== "README.md") {
      out.push(p);
    }
  }
  return out;
}

let _cache: Doc[] | null = null;

function loadAll(): Doc[] {
  if (_cache) return _cache;
  type Raw = { stem: string; section: SectionKey; data: Record<string, unknown>; content: string };
  const raws: Raw[] = [];
  for (const key of Object.keys(SECTIONS) as SectionKey[]) {
    for (const f of walk(path.join(VAULT_DIR, SECTIONS[key].dir))) {
      const { data, content } = matter(fs.readFileSync(f, "utf-8"));
      raws.push({ stem: path.basename(f, ".md"), section: key, data, content });
    }
  }
  const stems = new Set(raws.map((r) => r.stem));

  // [[대상#앵커|표시]] → [표시](/d/대상/#앵커). 미해결(레지스트리에 없음)은 표시 텍스트로.
  const resolveWikilinks = (md: string): string =>
    md.replace(/\[\[([^\]|#\n]+)(#[^\]|\n]+)?(?:\|([^\]\n]+))?\]\]/g, (_m, target, anchor, alias) => {
      const t = String(target).trim();
      const disp = String(alias || t).trim();
      const a = anchor ? String(anchor) : "";
      return stems.has(t) ? `[${disp}](/d/${t}/${a})` : disp;
    });

  _cache = raws.map((r) => {
    const title = String(r.data["규정명"] || r.data["제목"] || r.data["용어"] || r.stem);
    return {
      slug: r.stem,
      title,
      section: r.section,
      category: String(r.data["분류"] || ""),
      regNo: String(r.data["규정번호"] || ""),
      revised: String(r.data["개정일"] || ""),
      reviewed: String(r.data["검수상태"] || ""),
      type: String(r.data["type"] || ""),
      articleCount: (r.content.match(/^\s*제\s*\d+\s*조/gm) || []).length,
      body: resolveWikilinks(r.content),
    };
  });
  return _cache;
}

export function getAllDocs(): DocMeta[] {
  return loadAll()
    .map(({ body, ...meta }) => meta)
    .sort((a, b) => (a.regNo || "9999").localeCompare(b.regNo || "9999") || a.title.localeCompare(b.title));
}

export function getDoc(slug: string): Doc | null {
  return loadAll().find((d) => d.slug === slug) || null;
}

// 백링크: 이 문서를 본문에서 가리키는 다른 문서들
export function getBacklinks(slug: string): DocMeta[] {
  const all = loadAll();
  return all
    .filter((d) => d.slug !== slug && new RegExp(`\\(/d/${escapeReg(slug)}/`).test(d.body))
    .map(({ body, ...meta }) => meta);
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 관계 그래프: 노드 = 문서, 엣지 = 본문의 위키링크(상호참조)
export type GraphData = {
  nodes: { id: string; title: string; section: SectionKey; deg: number }[];
  links: { source: string; target: string }[];
};

export function getGraph(): GraphData {
  const all = loadAll();
  const stems = new Set(all.map((d) => d.slug));
  const deg: Record<string, number> = {};
  const links: { source: string; target: string }[] = [];
  const seen = new Set<string>();
  for (const d of all) {
    for (const m of d.body.matchAll(/\]\(\/d\/([^/)#]+)\//g)) {
      const t = m[1];
      if (t === d.slug || !stems.has(t)) continue;
      const key = `${d.slug}→${t}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: d.slug, target: t });
      deg[d.slug] = (deg[d.slug] || 0) + 1;
      deg[t] = (deg[t] || 0) + 1;
    }
  }
  const nodes = all.map((d) => ({
    id: d.slug,
    title: d.title,
    section: d.section,
    deg: deg[d.slug] || 0,
  }));
  return { nodes, links };
}
