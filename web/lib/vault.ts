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
  시스템: { dir: "40_시스템", label: "사내 시스템", desc: "ERP·그룹웨어·연구관리(PMS) 등 사내 시스템 메뉴·기능" },
  // 대외업무(docs/39): 대외요구자료 3개년 운영 통계·업무별 가이드. ⚠ 규정집·연구행정 가이드(ERP 원문)와
  // 성격이 달라(내부 관측 통계) 별도 섹션으로 분리 — 혼선 방지.
  대외업무: { dir: "50_대외업무", label: "대외업무", desc: "대외요구자료 반복업무(국정감사·예산·결산 등) 운영 통계·가이드" },
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

  // 날짜 정규화(v1 스펙 B2): gray-matter가 YAML 날짜(개정일: 2021-08-17)를 JS Date로 파싱해
  // String()하면 "Tue Aug 17 2021 09:00:00 GMT+0900…"가 화면·docdata에 그대로 노출된다.
  // Date → YYYY-MM-DD(로컬 기준), 그 외는 문자열 그대로.
  const fmtDate = (v: unknown): string => {
    if (v instanceof Date && !isNaN(v.getTime())) {
      const p = (n: number) => String(n).padStart(2, "0");
      return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
    }
    return String(v ?? "");
  };

  _cache = raws.map((r) => {
    const title = String(r.data["규정명"] || r.data["제목"] || r.data["용어"] || r.stem);
    return {
      slug: r.stem,
      title,
      section: r.section,
      category: String(r.data["분류"] || ""),
      regNo: String(r.data["규정번호"] || ""),
      revised: fmtDate(r.data["개정일"] || r.data["최종검토일"] || ""),
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

// ── 업무 한 장(여정) — 볼트 90_관리/_journeys/*.json (docs/25). 규정 파생 콘텐츠라 볼트에 둔다. ──
export type JourneyBasis = { 규정명: string; 조: string };
export type JourneyNode = {
  id: string; name: string; lane: string; stage: string; action: string;
  erp?: { 화면: string; 코드: string; 경로: string };
  기한?: { text: string; 근거: JourneyBasis };
  전결?: { 사다리: string; 근거: JourneyBasis };
  근거: JourneyBasis[];
};
export type Journey = {
  id: string; title: string; emoji: string; 요약: string; 검수상태: string;
  lanes: string[]; stages: string[]; nodes: JourneyNode[]; edges: [string, string][];
};

// ── 업데이트 노트('새로워진 점', docs/32) — 볼트 90_관리/_changelog/*.md ──
// 노트 본문은 볼트(비공개)에만 있고, 사이트는 빌드타임에 정적으로 굽는다.
export type ChangelogEntry = {
  id: string;        // 파일명(확장자 제외) — 배너 '닫음' 기억 키
  제목: string;
  날짜: string;       // YYYY-MM-DD
  분류: string;       // 신규 | 개선 | 수정 | 데이터
  요약: string;       // 배너용 한 줄
  관련페이지: string | null; // undefined는 SSG props 직렬화 불가 — null 고정
  body: string;      // 마크다운 본문
};

export function loadChangelog(): ChangelogEntry[] {
  const dir = path.join(VAULT_DIR, "90_관리", "_changelog");
  if (!fs.existsSync(dir)) return [];
  const out: ChangelogEntry[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    try {
      const raw = fs.readFileSync(path.join(dir, f), "utf-8");
      const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      if (!m) continue;
      const meta: Record<string, string> = {};
      for (const ln of m[1].split("\n")) {
        const i = ln.indexOf(":");
        if (i > 0) meta[ln.slice(0, i).trim()] = ln.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      }
      if (meta.type !== "changelog" || !meta["제목"] || !meta["날짜"] || !meta["요약"]) continue;
      out.push({
        id: f.replace(/\.md$/, ""),
        제목: meta["제목"], 날짜: meta["날짜"], 분류: meta["분류"] || "개선",
        요약: meta["요약"], 관련페이지: meta["관련페이지"] || null,
        body: m[2].trim(),
      });
    } catch {
      /* 손상 노트는 건너뜀 */
    }
  }
  // 최신순(날짜 → 파일명)
  out.sort((a, b) => (a.날짜 === b.날짜 ? (a.id < b.id ? 1 : -1) : a.날짜 < b.날짜 ? 1 : -1));
  return out;
}

// ── 이벤트탭 "지금 KEI에서"(docs/35) — 시즌 캘린더·최근 개정·용어 목록(빌드타임) ──
export type SeasonalItem = {
  month: number; // 0=매월(상시, docs/39) · 1~12=해당 월
  title: string; desc?: string; 시기?: string;
  구분?: string | null; // 항목 성격 칩(예: "대외업무") — 1단어, calendar_lint 검사
  관련페이지?: string | null; 근거?: string | null; 상태: string; // 예시 | 확정
  근거slug?: string | null; // 근거 문서 제목 → slug 해석(링크용)
};

export function loadSeasonal(): SeasonalItem[] {
  const fp = path.join(VAULT_DIR, "90_관리", "_calendar", "seasonal.json");
  if (!fs.existsSync(fp)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(fp, "utf-8")) as SeasonalItem[];
    if (!Array.isArray(raw)) return [];
    const titleToSlug = new Map<string, string>();
    for (const d of getAllDocs()) if (!titleToSlug.has(d.title)) titleToSlug.set(d.title, d.slug);
    return raw
      .filter((it) => it && Number.isInteger(it.month) && it.month >= 0 && it.month <= 12
        && typeof it.title === "string" && it.title.trim())
      .map((it) => ({
        month: it.month, title: it.title, desc: it.desc || "", 시기: it.시기 || "",
        // SSG 직렬화: undefined 금지 — 반드시 null 정규화(리뷰 확정)
        구분: typeof it.구분 === "string" && it.구분.trim() ? it.구분.trim() : null,
        // 관련페이지는 내부 경로(/...)만 — 외부 URL·javascript: 등은 링크로 만들지 않는다(calendar_lint와 동일 규약)
        관련페이지: typeof it.관련페이지 === "string" && /^\/[^\s]*$/.test(it.관련페이지) ? it.관련페이지 : null,
        근거: it.근거 || null,
        상태: it.상태 === "확정" ? "확정" : "예시",
        근거slug: (it.근거 && titleToSlug.get(it.근거)) || null,
      }));
  } catch {
    return []; // 손상 파일 — 빌드는 계속(빈 캘린더)
  }
}

// 최근 개정된 규정 상위 N — 프론트매터 개정일(YYYY-MM-DD, 월 단위 YYYY-MM도 허용) 내림차순.
// 월 단위 날짜는 사전순 비교에서 같은 달의 일 단위 날짜보다 앞(=더 과거 취급) — 표시상 무해.
export function recentlyRevised(n = 5): { slug: string; title: string; revised: string }[] {
  return getAllDocs()
    .filter((d) => d.section === "규정집" && /^\d{4}-\d{2}(-\d{2})?$/.test(d.revised))
    .sort((a, b) => b.revised.localeCompare(a.revised))
    .slice(0, n)
    .map((d) => ({ slug: d.slug, title: d.title, revised: d.revised }));
}

// 오늘의 용어 후보 — 용어집 전체(가벼운 slug·제목만). '오늘' 선택은 클라이언트(날짜 시드).
export function termPool(): { slug: string; title: string }[] {
  return getAllDocs()
    .filter((d) => d.section === "용어집")
    .map((d) => ({ slug: d.slug, title: d.title }));
}

// ── 서식 찾기(docs/34 ①) — 규정 원문의 별지 서식 대장(빌드타임 추출, 수작업 0) ──
export type FormEntry = {
  규정명: string;
  slug: string;
  호: string;           // "별지 제N호"·"별지 제6-1호"·"별지 제19호의2" — 표시·앵커·dedup 공용 라벨
  호수: number;         // 번호 검색용 첫 숫자
  서식명: string;       // ①01p manifest의 원문 제목(PDF 최대 폰트) ②라벨 줄 잔여 ③다음 의미 줄
  anchor: string;       // 문서 내 앵커 id(=호) — Markdown 렌더러의 별지 id 규칙과 동기(적대 검증 확정)
  pdf: string | null;   // 별지 원문 PDF 다운로드 경로(01p 분리본, git-external — 없으면 null)
  hwp: string | null;   // 규정 원문 HWP(전체) — 실편집용. 별지만 HWP 분리는 포맷상 불가(docs/50 §7)
};

// 01p_byeolji_pdf.py manifest — 규정↔별지↔원문 PDF·서식명(원문 제목). git-external(없으면 빈 객체).
type ByeoljiManifest = Record<string, { hwp?: string | null; 별지: { label: string; name: string; pdf: string }[] }>;
let _byeoljiMf: ByeoljiManifest | null = null;
function byeoljiManifest(): ByeoljiManifest {
  if (_byeoljiMf) return _byeoljiMf;
  try {
    const p = path.resolve(process.cwd(), "..", "tools", "index", "byeolji_manifest.json");
    _byeoljiMf = JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    _byeoljiMf = {};
  }
  return _byeoljiMf!;
}

// 줄 시작 라벨만 서식 블록으로 인정. 변형 실측(적대 검증): [별지…]·<별지…>·【별지…】·〔별지…]·
// (별지…)·표 셀 '| [별지…'·하이픈 호수(제6-1호)·가지 호수(제19호의2)까지 지원.
// ⚠ web/components/Markdown.tsx의 별지 앵커 정규식과 반드시 동기 유지.
const FORM_LABEL = /^[\s|]*[\[<【〔(]?\s*별지\s*제?\s*(\d+(?:-\d+)?)\s*호(의\s*\d+)?[^\n]*/;

export function loadForms(): FormEntry[] {
  const out: FormEntry[] = [];
  const seen = new Set<string>();
  for (const meta of getAllDocs()) {
    if (meta.section !== "규정집") continue;
    const doc = getDoc(meta.slug);
    if (!doc) continue;
    const lines = doc.body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(FORM_LABEL);
      if (!m) continue;
      // 폐지 서식 제외 — 라벨 닫힘 뒤의 '삭제' 표기로 한정(서식명에 '삭제'가 든 오배제 방지)
      if (/[\]>】〕)]\s*<?삭제|서식\]?\s*삭제/.test(lines[i])) continue;
      const label = `별지 제${m[1]}호${(m[2] || "").replace(/\s+/g, "")}`;
      const key = `${meta.slug}#${label}`;
      if (seen.has(key)) continue; // 같은 문서 같은 호 중복 라벨은 첫 블록만
      // 서식명 후보 ①: 라벨 줄의 잔여 텍스트(태그·괄호·파이프 제거 후) — 같은 줄 제목 지원
      const rest = lines[i]
        .replace(FORM_LABEL, "")
        .replace(/<[^>]*>/g, "")
        .replace(/[\]】〕>|]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      let title = /[가-힣A-Za-z]{2,}/.test(rest) ? rest.slice(0, 40) : "";
      // 후보 ②: 다음 의미 줄 — 다열 표 행(셀 2+)·결재란 조각·태그·구분선 제외.
      // 단일 셀 표('| 제목 |')는 서식 제목의 흔한 형태라 수용(적대 검증 후 회귀 수정).
      if (!title) {
        for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
          const raw = lines[j].trim();
          if (!raw || raw.startsWith("<") || /^[\s|:\-–—]*$/.test(raw)) continue;
          const cells = raw.split("|").map((c) => c.trim()).filter(Boolean);
          if (cells.length >= 2) continue; // 다열 표 행(결재란 등) — 제목 아님
          const inner = cells[0] || "";
          if (/^(결\s*재|담\s*당|부서장|실\(팀\)장|원\s*장)/.test(inner)) continue;
          if (!/[가-힣A-Za-z]{2,}/.test(inner)) continue; // 깨진 문자·기호만인 줄
          title = inner.replace(/\s+/g, " ").slice(0, 40);
          break;
        }
      }
      seen.add(key);
      // 01p manifest 조인 — 깨진 md 휴리스틱 제목('10일 이내'류)을 원문 제목으로 교정 + 다운로드 PDF/HWP
      const mf = byeoljiManifest()[meta.slug];
      const mfe = (mf?.별지 || []).find((b) => b.label === label);
      const mfName = (mfe?.name || "").trim();
      if (mfName && /[가-힣A-Za-z]{2,}/.test(mfName)) title = mfName.slice(0, 40);
      out.push({ 규정명: doc.title, slug: meta.slug, 호: label, 호수: Number(m[1].split("-")[0]),
                 서식명: title || "(서식명 미기재)", anchor: label,
                 pdf: mfe ? `/${mfe.pdf}` : null,
                 hwp: mf?.hwp ? `/${mf.hwp}` : null });
    }
  }
  out.sort((a, b) => (a.규정명 === b.규정명
    ? a.호수 - b.호수 || a.호.localeCompare(b.호, "ko")
    : a.규정명.localeCompare(b.규정명, "ko")));
  return out;
}

export function loadJourneys(): Journey[] {
  const dir = path.join(VAULT_DIR, "90_관리", "_journeys");
  if (!fs.existsSync(dir)) return [];
  const out: Journey[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as Journey);
    } catch {
      /* 손상 파일은 건너뜀 */
    }
  }
  return out;
}
