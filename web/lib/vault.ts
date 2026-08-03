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
  // 상위법령(docs/61): 국가 법령·NRC 공통규정 — ⛔ KEI 사내 규정 아님(층위 구분 배지 필수).
  // 검색·RAG는 별도 컬렉션(kei_uplaw)이 담당, 여기는 사람 둘러보기·원문 열람용.
  상위법령: { dir: "25_상위법령", label: "상위 법령(참고)", desc: "KEI에 적용되는 국가 법령·연구회 공통 규범 — 사내 규정 아님, 세부 기준은 사내 규정 우선" },
} as const;
export type SectionKey = keyof typeof SECTIONS;

// 슬러그 → URL 조각. ⚠ encodeURIComponent는 **괄호 ( )를 인코딩하지 않는다** — 슬러그에 괄호가
// 있으면(예: "연구관리시스템(PMS) 개요") 마크다운 링크 `](/d/…(PMS)…)`의 `)`가 링크를 조기
// 종료시켜 렌더가 깨지고, 그래프 링크 추출 정규식 `[^/)#]+`도 `)`에서 잘려 엣지가 유실된다.
// 그래서 괄호까지 %28/%29로 인코딩한다(공백 %20은 encodeURIComponent가 처리). 2026-07-21.
// 역변환은 decodeURIComponent(라우팅·그래프 대조)로 안전. resolveWikilinks·getBacklinks·getGraph 공용.
export const encSlug = (s: string): string =>
  encodeURIComponent(s).replace(/\(/g, "%28").replace(/\)/g, "%29");

export type DocMeta = {
  slug: string; // = 파일 stem (라우트 id)
  title: string;
  section: SectionKey;
  category: string; // 분류 폴더(예: 3000_인사)
  regNo: string; // 규정번호
  revised: string; // 개정일
  reviewed: string; // 검수상태
  strength: string; // 적용강도(상위법령 전용: 직접|준거|참고 — 그 외 "")
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
      const a = anchor ? `#${encSlug(String(anchor).slice(1))}` : "";
      return stems.has(t) ? `[${disp}](/d/${encSlug(t)}/${a})` : disp;
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
    const title = String(r.data["규정명"] || r.data["제목"] || r.data["용어"] || r.data["법령명"] || r.stem);
    return {
      slug: r.stem,
      title,
      section: r.section,
      category: String(r.data["분류"] || r.data["소관"] || ""),  // 상위법령은 소관부처가 분류 필터 역할
      regNo: String(r.data["규정번호"] || ""),
      strength: String(r.data["적용강도"] || ""),
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
// ⚠ body의 /d/ 링크는 resolveWikilinks가 encodeURIComponent로 굽는다 — 검색도 인코딩형으로.
export function getBacklinks(slug: string): DocMeta[] {
  const all = loadAll();
  const enc = escapeReg(encSlug(slug));  // 본문 링크와 동일 인코딩(괄호 %28/%29 포함)
  return all
    .filter((d) => d.slug !== slug && new RegExp(`\\(/d/${enc}/`).test(d.body))
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
      // ⚠ body 링크는 URL 인코딩돼 있다(resolveWikilinks) — 디코딩해서 슬러그와 대조.
      //   (안 하면 stems 불일치로 엣지가 전부 버려져 그래프가 '0개 연결'이 된다 — 실사고 2026-07-20)
      let t: string;
      try { t = decodeURIComponent(m[1]); } catch { t = m[1]; }
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
// 신선도(specs/13 T01) — 01k2가 노드 근거를 조문 효력 인덱스와 대조한 결과.
// 여정은 사람이 손으로 만들어 규정 개정 시 조용히 낡는다. 화면이 그 사실을 말해야 한다.
export type JourneyFreshness = {
  최고심각도: "삭제" | "미확인" | "개정";
  건수: number;
  항목: { 노드: string; 노드명: string; 규정명: string; 조: string; 심각도: string; 사유: string }[];
};
export type Journey = {
  id: string; title: string; emoji: string; 요약: string; 검수상태: string;
  lanes: string[]; stages: string[]; nodes: JourneyNode[]; edges: [string, string][];
  신선도?: JourneyFreshness;   // 인덱스 없거나 이상 없으면 undefined(= 배지 없음)
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

// ── 버그리포트(docs/32 §7) — 볼트 90_관리/_changelog/*.md 중 type: bugreport ──
// 트러블슛 원문 = md 파일(단일 출처), 페이지는 빌드타임에 굽는다. 상세 기술 원문은
// 레포 docs/*(버전관리)가 소유하고, 여기 노트는 사용자용 서술(문제→원인→해결→개선).
// ⛔ 규정 값·내부 인프라(경로·포트) 금지 — changelog_lint가 bugreport 규약도 강제.
export type BugReport = {
  id: string;
  제목: string;
  날짜: string;      // YYYY-MM-DD
  버전: string;      // vYYYY.MM.DD — 릴리스 일자 기반 표기(docs/32 §7)
  영역: string;      // 서식 다운로드 | 검색 품질 | 답변 품질 | 화면 | 빌드·배포 …
  심각도: string;    // 높음 | 보통 | 낮음
  요약: string;      // 카드 접힘 상태에서 보이는 한 줄(증상 요약)
  body: string;      // ## 증상 / ## 원인 / ## 해결 / ## 개선 효과 (+ ## 재발 방지)
};

export function loadBugReports(): BugReport[] {
  const dir = path.join(VAULT_DIR, "90_관리", "_changelog");
  if (!fs.existsSync(dir)) return [];
  const out: BugReport[] = [];
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
      if (meta.type !== "bugreport" || !meta["제목"] || !meta["날짜"] || !meta["버전"] || !meta["요약"]) continue;
      out.push({
        id: f.replace(/\.md$/, ""),
        제목: meta["제목"], 날짜: meta["날짜"], 버전: meta["버전"],
        영역: meta["영역"] || "일반", 심각도: meta["심각도"] || "보통",
        요약: meta["요약"], body: m[2].trim(),
      });
    } catch {
      /* 손상 노트는 건너뜀 */
    }
  }
  out.sort((a, b) => (a.날짜 === b.날짜 ? (a.id < b.id ? 1 : -1) : a.날짜 < b.날짜 ? 1 : -1));
  return out;
}

// ── 업무 도구 탭(/now, 옛 이름 "지금 KEI에서", docs/35) — 시즌 캘린더·최근 개정·용어 목록(빌드타임) ──
export type SeasonalItem = {
  month: number; // 0=매월(상시, docs/39) · 1~12=해당 월
  title: string; desc?: string; 시기?: string;
  구분?: string | null; // 항목 성격 칩(예: "대외업무") — 1단어, calendar_lint 검사
  관련페이지?: string | null; 근거?: string | null; 상태: string; // 예시 | 확정
  근거slug?: string | null; // 근거 문서 제목 → slug 해석(링크용)
};

// 대외업무 월 상세(01r_seasonal_survey — 3개년 전수조사 추출, docs/39 보강 2026-07-24).
// ⛔ 운영 통계 — 규정 아님. 캘린더 월 클릭 상세 패널이 소비.
export type MonthlySurvey = {
  totals: { year: string; n: string }[];
  months: Record<string, {
    counts: { year: string; n: number | null }[];
    features: { year: string; text: string }[];
    notes: string[];
  }>;
};
export function loadMonthlySurvey(): MonthlySurvey | null {
  const fp = path.join(VAULT_DIR, "90_관리", "_calendar", "monthly_survey.json");
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return null;
  }
}

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
  구분?: "별지" | "연구관리" | "상위법령";  // 서식 출처 — 규정 별지 | PMS 양식 | 상위법령 별표(law.go.kr, docs/61 v2)
  쪽수?: number | null;  // 미리보기 PDF 분량(쪽) — 별지=manifest pages, PMS=01x가 기록. '한 장' 배지용
  꼬리넘침?: boolean;    // 다쪽이나 끝 장이 서명란 한 줄뿐(01s 판정) — 실질 한 장, 배지 과잉경고 방지(docs/50 §8d)
};

// PMS 연구관리양식(docs/55 §8③) — 규정 별지가 아니라 '시스템 부착 양식'이라 두 번째 소스.
// 원본·PDF 미리보기는 web/public/forms-pdf/pms/<카테고리>/(git-external), 목록은 같은 곳의
// manifest.json(변환 파이프가 emit). 없으면 빈 배열(별지처럼 git-external 안전).
// 규정명 자리에 '연구관리양식 · <카테고리>'를 넣어 기존 규정 필터가 카테고리 필터로 그대로 작동한다.
// PMS 양식 표시명 정리 — 원본 파일명이 영문 번역을 공백 없이 뭉쳐(예:
// 'ConfirmationCertificateRegardingRestrictions…') 표시명이 거대한 런온이 되는 문제.
// 괄호 안이 15자↑ & 대부분(≥70%) ASCII 영숫자면 '영문/코드 런온'으로 보고 제거.
// ⚠ 한글이 2자↑ 남을 때만 정리본 채택(영문 전용 서식은 원문 유지) · 데이터(manifest)는 불변.
// 서식명 표시 정리(호롱 폴리시) — kordoc 재변환 문서의 제목 헤딩(## )·볼드(**) 마커가
// 서식명에 노출되는 것 방지(개인정보보호지침 별지10 '## 위임장' 실측). 데이터(원문)는 불변.
function cleanFormTitle(t: string): string {
  return t.replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "").trim();
}

function cleanPmsTitle(s: string): string {
  const cleaned = s
    .replace(/\(([^)]{15,})\)/g, (m, inner: string) => {
      const ascii = (inner.match(/[A-Za-z0-9]/g) || []).length;
      return ascii / inner.length >= 0.7 ? "" : m;
    })
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([)\]])/g, "$1")
    .trim();
  return /[가-힣]{2,}/.test(cleaned) ? cleaned : s;
}

function loadPmsForms(): FormEntry[] {
  const mf = path.join(process.cwd(), "public", "forms-pdf", "pms", "manifest.json");
  if (!fs.existsSync(mf)) return [];
  try {
    const items: { 카테고리: string; 파일: string; 표시명: string; pdf?: string | null; 쪽수?: number | null }[] =
      JSON.parse(fs.readFileSync(mf, "utf-8"));
    // '원문 보기'는 이 양식들이 올라 있는 PMS 화면 설명(상세가이드 · 과제관리 § 연구관련양식)으로.
    const guideSlug = "연구관리시스템(PMS) 상세가이드 · 과제관리";
    const hasGuide = getAllDocs().some((d) => d.slug === guideSlug);
    return items.map((it) => ({
      규정명: `연구관리양식 · ${it.카테고리}`,
      slug: hasGuide ? guideSlug : "",
      호: "", 호수: 0,
      서식명: cleanPmsTitle(it.표시명),
      anchor: hasGuide ? "연구관련양식" : "",
      pdf: it.pdf ? `/forms-pdf/pms/${encodeURIComponent(it.카테고리)}/${encodeURIComponent(it.pdf)}` : null,
      hwp: `/forms-pdf/pms/${encodeURIComponent(it.카테고리)}/${encodeURIComponent(it.파일)}`,
      구분: "연구관리" as const,
      쪽수: typeof it.쪽수 === "number" ? it.쪽수 : null,
    }));
  } catch {
    return [];
  }
}

// 01p_byeolji_pdf.py manifest — 규정↔별지↔원문 PDF·서식명(원문 제목). git-external(없으면 빈 객체).
type ByeoljiManifest = Record<string, { hwp?: string | null; 별지: { label: string; name: string; pdf: string; pages?: [number, number]; 꼬리넘침?: boolean }[] }>;
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

// 상위법령 별표·서식(docs/61 v2) — 01h --annex가 law.go.kr 원문 PDF + manifest를 emit.
// ⛔ 사내 규정 아님(법제처 원문 그대로) — 규정명 접두 '상위법령 · '으로 필터에서 구분.
function loadUplawForms(): FormEntry[] {
  const mf = path.join(process.cwd(), "public", "forms-pdf", "uplaw", "manifest.json");
  if (!fs.existsSync(mf)) return [];
  try {
    const items: { 법령명: string; 라벨: string; 제목: string; pdf: string; 구분: string; 쪽수?: number | null }[] =
      JSON.parse(fs.readFileSync(mf, "utf-8"));
    const stems = new Set(getAllDocs().map((d) => d.slug));
    return items.map((it) => ({
      규정명: `상위법령 · ${it.법령명}`,
      slug: stems.has(it.법령명) ? it.법령명 : "",   // 원문 보기 = 25_상위법령 문서(본문은 조문만·별표는 PDF)
      호: it.라벨,
      호수: Number((it.라벨.match(/\d+/) || ["0"])[0]),
      서식명: it.제목,
      anchor: "",                                    // 본문에 별표 텍스트 없음(v1 조문만) — PDF가 정본
      pdf: `/forms-pdf/uplaw/${it.pdf}`,
      hwp: null,
      구분: "상위법령" as const,
      쪽수: it.쪽수 ?? null,
    }));
  } catch {
    return [];
  }
}

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
                 서식명: cleanFormTitle(title) || "(서식명 미기재)", anchor: label,
                 pdf: mfe ? `/${mfe.pdf}` : null,
                 hwp: mf?.hwp ? `/${mf.hwp}` : null,
                 쪽수: mfe?.pages ? mfe.pages[1] - mfe.pages[0] + 1 : null,
                 ...(mfe?.꼬리넘침 ? { 꼬리넘침: true } : {}) });
    }
  }
  out.sort((a, b) => (a.규정명 === b.규정명
    ? a.호수 - b.호수 || a.호.localeCompare(b.호, "ko")
    : a.규정명.localeCompare(b.규정명, "ko")));
  // PMS 연구관리양식(두 번째 소스) — 별지 뒤에 카테고리·이름순으로 이어붙인다
  const pms = loadPmsForms();
  pms.sort((a, b) => a.규정명.localeCompare(b.규정명, "ko") || a.서식명.localeCompare(b.서식명, "ko"));
  const uplaw = loadUplawForms();
  uplaw.sort((a, b) => a.규정명.localeCompare(b.규정명, "ko") || a.호수 - b.호수);
  return out.concat(pms, uplaw);
}

// ── 기한 사전(docs/57) — 전 규정 상대기한 228건 역방향 브라우저(사건→규정). ──
// 데이터원 tools/index/deadlines.json(01m 생성, git-external — 없으면 빈 배열). ⛔ 창작 0.
export type DeadlineEntry = {
  규정명: string;
  slug: string | null;   // 드로어 링크용 문서 slug(규정명↔문서 매칭 실패 시 null=비클릭)
  regNo: string;         // 규정번호(계산 근거 표기용)
  조: string;
  의무: string;          // 제출·보고·신고… (빈 값 가능)
  anchor: string;        // 사건 기준점("공무출장 후" 등, 빈 값 가능)
  n: number;
  unit: string;          // 일·주·개월·년
  dir: string;           // 이내 | 전
  type: string;          // 마감 | 기간한도
  원문: string;          // 검증용 규정 원문 문장(그대로)
  라벨사건?: string;     // 01m2 자동 라벨(Qwen, 검증 게이트 통과분) — 표시용, 검수 전. 없으면 anchor 폴백
  라벨행동?: string;     // 〃 기한 내 해야 할 일
  라벨대상?: string;     // 기간한도용 — 무엇의 기간인지(예: "재택근무 근무기간")
};

export function loadDeadlines(): DeadlineEntry[] {
  let raw: { deadlines?: Record<string, unknown[]> };
  try {
    const p = path.resolve(process.cwd(), "..", "tools", "index", "deadlines.json");
    raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return [];
  }
  // 01m2 자동 라벨(있으면) — 파편 anchor를 사람이 읽을 사건·행동으로. 없어도 안전(anchor 폴백)
  let labels: Record<string, { 사건?: string; 행동?: string; 대상?: string; 판정?: string }> = {};
  try {
    labels = JSON.parse(fs.readFileSync(
      path.resolve(process.cwd(), "..", "tools", "index", "deadline_labels.json"), "utf-8"));
  } catch { /* 라벨 파일 없음 — 폴백 */ }
  const titleToSlug = new Map<string, string>();
  const titleToNo = new Map<string, string>();
  for (const d of getAllDocs()) {
    if (!titleToSlug.has(d.title)) {
      titleToSlug.set(d.title, d.slug);
      titleToNo.set(d.title, d.regNo || "");
    }
  }
  const out: DeadlineEntry[] = [];
  for (const [규정명, list] of Object.entries(raw.deadlines || {})) {
    for (const e of (list || []) as Record<string, unknown>[]) {
      // 01m2 라벨 키와 동기(규정명|조|N단위방향|원문 40자)
      const lk = `${규정명}|${e.조}|${e.n}${e.unit}${e.dir}|${String(e.원문 || "").slice(0, 40)}`;
      const lab = labels[lk] || {};
      // 01m2 재판정 '기한아님' = 01m 오추출(정의·빈도한도·조건) — 표시 제외(원본 json 불변)
      if (lab.판정 === "기한아님") continue;
      out.push({
        규정명,
        slug: titleToSlug.get(규정명) ?? null,
        regNo: titleToNo.get(규정명) || "",
        조: String(e.조 || ""),
        의무: String(e.의무 || ""),
        anchor: String(e.anchor || ""),
        n: Number(e.n) || 0,
        unit: String(e.unit || ""),
        dir: String(e.dir || ""),
        type: String(e.type || ""),
        원문: String(e.원문 || ""),
        라벨사건: lab.사건 || "",
        라벨행동: lab.행동 || "",
        라벨대상: lab.대상 || "",
        // 재판정이 기간한도로 정정한 항목은 type도 표시용으로 정정(원본 불변)
        ...(lab.판정 === "기간한도" ? { type: "기간한도" } : {}),
      });
    }
  }
  // 계산 가능(마감·anchor 有) 우선 → 규정명 → 조. 브라우즈 첫 화면이 바로 쓸모 있게.
  const rank = (x: DeadlineEntry) => (x.type === "마감" && x.anchor ? 0 : 1);
  return out.sort(
    (a, b) => rank(a) - rank(b) || a.규정명.localeCompare(b.규정명, "ko") || a.조.localeCompare(b.조, "ko")
  );
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
  // 신선도 부착(specs/13 T01b) — 인덱스가 없으면 조용히 넘어간다(01k2 미실행 환경에서도 빌드 성공).
  const fresh = loadJson("journey_freshness.json");
  if (fresh?.여정별) {
    for (const j of out) {
      const s = fresh.여정별[j.id];
      if (!s?.최고심각도) continue;
      j.신선도 = {
        최고심각도: s.최고심각도, 건수: s.건수 ?? 0,
        항목: (fresh.항목 || []).filter((r: any) => r.여정 === j.id).map((r: any) => ({
          노드: r.노드, 노드명: r.노드명, 규정명: r.규정명, 조: r.조, 심각도: r.심각도, 사유: r.사유,
        })),
      };
    }
  }
  return out;
}

// tools/index 파생 인덱스 로더(빌드타임 전용) — emit-docdata의 loadJson과 동일 규약(부재 시 null)
function loadJson(name: string): any {
  try {
    const p = path.resolve(process.cwd(), "..", "tools", "index", name);
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

// ── 개정 영향 분석(specs/05) — 01l impact_by_article + article_status 결합 슬라이스 ──
// 목록은 '확인 후보'(과탐 허용) — 화면 문구가 단정을 막는다. 데이터는 전부 결정적(LLM 무관).
export type ImpactArticle = {
  key: string; reg: string; jo: string; title: string;
  revised: string; recentRevised: boolean;   // 최근 90일 개정(빌드 시점 기준)
  direct?: string[]; transitive?: string[]; guides?: string[]; forms?: string[]; deadlines?: string[];
};
export type ImpactPayload = { items: ImpactArticle[]; regSlugs: Record<string, string> };

export function loadImpact(): ImpactPayload {
  const ga = loadJson("graph_analytics.json");
  const st = loadJson("article_status.json");
  const ai: Record<string, any> = ga?.impact_by_article || {};
  const arts: Record<string, any> = st?.articles || {};
  const stemOf = (p: string) => (p || "").split("/").pop()?.replace(/\.md$/, "") || "";
  // 규정명 → slug(원문 문서) 매핑
  const reg2slug: Record<string, string> = {};
  for (const v of Object.values(arts) as any[]) {
    if (v?.규정명 && v?.path) reg2slug[v.규정명] = stemOf(v.path);
  }
  const docs = getAllDocs();
  const title2slug: Record<string, string> = {};
  for (const d of docs) title2slug[d.title] = d.slug;
  const now = Date.now();
  const out: ImpactArticle[] = [];
  for (const [key, v] of Object.entries(ai) as [string, any][]) {
    const [reg, jo] = key.split("#");
    const meta = arts[key] || {};
    const revised = String(meta.최근개정 || meta.개정일 || "");
    const rd = revised ? Date.parse(revised.replaceAll(".", "-")) : NaN;
    // ⚠ Next getStaticProps는 undefined를 직렬화 못 한다(kei_regs_v2 라벨 때와 동일 함정) —
    //   존재하는 필드만 키를 넣는다.
    const row: ImpactArticle = {
      key, reg, jo, title: String(meta.제목 || ""), revised,
      recentRevised: Number.isFinite(rd) && now - rd < 90 * 86400e3,
    };
    for (const t of ["direct", "transitive", "guides", "forms", "deadlines"] as const) {
      if (Array.isArray(v[t]) && v[t].length) row[t] = v[t];
    }
    out.push(row);
  }
  // 파급 넓은 순(확인 대상 많은 조문이 위로)
  const width = (i: ImpactArticle) =>
    (i.direct?.length || 0) + (i.transitive?.length || 0) + (i.guides?.length || 0) +
    (i.forms?.length || 0) + (i.deadlines?.length || 0);
  out.sort((a, b) => width(b) - width(a) || a.key.localeCompare(b.key));
  // 전역 규정명→slug 매핑 1벌(행별 중복 제거 — /impact 페이로드 387KB→슬림)
  return { items: out, regSlugs: reg2slug };
}

// ── 금액 구간 룰(specs/06) — 01r2 amount_rules.json을 그대로 전달(클라 재파싱 금지) ──
export function loadAmountRules(): Record<string, any> {
  return loadJson("amount_rules.json")?.rules || {};
}
