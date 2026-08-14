// 여비 계산기(docs/72 P1) — 빌드타임 데이터 공급.
//
// ⛔ 절대 규칙1: 금액은 **여비규정 별표 원문**에서만 온다. 이 파일은 볼트 원문
//    `20_규정원문/4000_보수·여비/4300_여비규정.md`의 별표 1·2·5와 제16~18조를 결정적으로
//    파싱할 뿐, 어떤 수치도 만들지 않는다. 파싱이 실패하면 그 항목은 **빈 값(null)**으로 두고
//    화면이 "원문 확인"을 안내한다(추정치 금지).
// ⛔ 화면 계산은 '표시된 정액 × 일수'와 그 단순 합산까지만. 비율·가산(일비 1/2 감액,
//    장기체재 감액, 상한 초과 추가지급)은 자동 적용하지 않고 원문 문장으로만 안내한다.
//
// 교차검증: tools/index/value_store.json(⛔검수완료+비손상 표만 수록, 01q)에 같은 값이
// 있는지 대조해 개수를 함께 넘긴다(화면 하단 표기). 대조는 '확인'일 뿐 값의 출처가 아니다.
import fs from "node:fs";
import path from "node:path";
import { VAULT_DIR } from "./vault";

const REG_REL = path.join("20_규정원문", "4000_보수·여비", "4300_여비규정.md");
export { TRAVEL_REG_NAME, TRAVEL_REG_SLUG } from "./travelMeta";
import { TRAVEL_REG_NAME } from "./travelMeta";

export type Grade = {
  호: string;        // "제1호"
  대상: string;      // "원장"
  원문행: string;    // 별표 1 표의 그 줄 그대로
};

/** 표 한 칸 = 원문 문자열 + (숫자로 확정될 때만) 값. 확정 못 하면 amount=null → 화면은 빈칸+안내. */
export type Cell = {
  원문: string;
  amount: number | null;
};

export type DomesticRow = {
  그룹: string;              // "제1호 내지 제4호"
  호: number[];              // [1,2,3,4]
  철도운임: string;
  선박운임: string;
  항공운임: string;
  자동차운임: string;
  일비: Cell;
  숙박비: Cell;              // 대개 "실비"(amount=null)
  숙박상한: { 지역: string; amount: number }[]; // 원문에 상한이 적힌 경우만
  식비: Cell;
  원문행: string;
};

export type OverseasRow = {
  그룹: string;              // "별표 1의 제1호에 해당하는 사람"
  호: number[];
  등급: string;              // 가·나·다·라
  일비: Cell;
  숙박상한: Cell;
  식비: Cell;
  원문행: string;
};

export type RegionGrade = {
  등급: string;              // 가·나·다·라
  국가: string[];
  원문행: string;
};

export type ArticleNote = { 조: string; 원문: string };

/** 별표 3 국외 항공운임 정액표 — 금액이 아니라 좌석 등급 표기(원문 그대로). */
export type Airfare = { 대상: string; 호: number[]; 등급: string; 원문행: string };

export type TravelRates = {
  ok: boolean;
  grades: Grade[];
  domestic: DomesticRow[];
  domesticNotes: string[];
  overseas: OverseasRow[];
  overseasCurrency: string;  // 원문 표기 그대로("미 달러화($)")
  airfare: Airfare[];        // 별표 3(국외 항공 좌석 등급)
  regions: RegionGrade[];
  /** 근무지 내 국내 출장(제18조) — 정액 2종. 못 읽으면 null. */
  inArea: { 이상4시간: Cell; 미만4시간: Cell; 원문: string } | null;
  notes: ArticleNote[];      // 자동 계산에 반영하지 않는 감액·특례 조문(원문 그대로)
  개정일: string;
  valueStoreChecked: number; // value_store.json에서 같은 값을 확인한 국외 지급표 칸 수
  valueStoreTotal: number;
};

const EMPTY: TravelRates = {
  ok: false, grades: [], domestic: [], domesticNotes: [], overseas: [],
  overseasCurrency: "", airfare: [], regions: [], inArea: null, notes: [], 개정일: "",
  valueStoreChecked: 0, valueStoreTotal: 0,
};

const clean = (s: string) =>
  s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/** "25,000" → 25000. 숫자만으로 이루어진 칸이 아니면 null(⛔ '실비'를 0으로 만들지 않는다). */
function toAmount(s: string): number | null {
  const t = clean(s);
  if (!/^[\d,]+$/.test(t)) return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
const cell = (raw: string): Cell => ({ 원문: clean(raw), amount: toAmount(raw) });

/** "별표 1의 제5호와 6호에 해당하는 사람" → [5,6] (⛔ '별표 1의'의 1은 '호'가 아니라 미매칭) */
function hoNumbers(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(/제?\s*(\d)\s*호/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 6 && !out.includes(n)) out.push(n);
  }
  // "제1호 내지 제4호" — 범위 표기는 사이 호를 채운다(원문 의미 그대로)
  if (/내지/.test(s) && out.length === 2 && out[1] > out[0]) {
    const range: number[] = [];
    for (let n = out[0]; n <= out[1]; n++) range.push(n);
    return range;
  }
  return out;
}

/** [별표 N] 마커부터 다음 별표 마커 전까지 잘라낸다. */
function annexSection(raw: string, n: number): string {
  const start = raw.indexOf(`[별표 ${n}]`);
  if (start < 0) return "";
  const rest = raw.slice(start + 6);
  const next = rest.search(/\[별표 \d\]/);
  return next < 0 ? rest : rest.slice(0, next);
}

function htmlRows(section: string): string[][] {
  const rows: string[][] = [];
  for (const tr of section.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = Array.from(tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)).map((m) => m[1]);
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function mdRows(section: string): string[][] {
  const rows: string[][] = [];
  for (const line of section.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|") || /^\|[\s|:-]+\|$/.test(t)) continue;
    rows.push(t.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  }
  return rows;
}

/** 조문 한 개의 본문(그 조 제목 줄부터 다음 '제N조(' 전까지) */
function article(raw: string, jo: number): string {
  const re = new RegExp(`^제${jo}조\\([^)]*\\)[\\s\\S]*?(?=^제\\d+조\\(|^## )`, "m");
  return (raw.match(re)?.[0] || "").trim();
}
/** 조문에서 첫 문장(①항)만 — 화면 근거 표시용 */
const firstPara = (s: string) => s.split("\n").find((l) => l.trim())?.trim() || "";

export function loadTravelRates(): TravelRates {
  let raw = "";
  try {
    raw = fs.readFileSync(path.join(VAULT_DIR, REG_REL), "utf-8");
  } catch {
    return EMPTY; // 볼트 없음(빌드 환경) — 화면이 "원문 확인" 안내
  }
  const 개정일 = raw.match(/^개정일:\s*(.+)$/m)?.[1]?.trim() || "";

  // ── 별표 1: 여비 지급 구분표 ──
  const a1 = annexSection(raw, 1);
  const grades: Grade[] = [];
  for (const r of mdRows(a1)) {
    if (r.length >= 2 && /^제\d호$/.test(r[0])) {
      grades.push({ 호: r[0], 대상: clean(r[1]), 원문행: `| ${r[0]} | ${clean(r[1])} |` });
    }
  }

  // ── 별표 2: 국내 여비 지급표(HTML 표) ──
  const a2 = annexSection(raw, 2);
  const domestic: DomesticRow[] = [];
  for (const cells of htmlRows(a2)) {
    const head = clean(cells[0]);
    if (!/제\d호/.test(head) || cells.length < 8) continue;
    const [, 철도, 선박, 항공, 자동차, 일비, 숙박, 식비] = cells;
    const 숙박cell = cell(숙박);
    const caps: { 지역: string; amount: number }[] = [];
    for (const [label, re] of [
      ["특별시", /특별시\s*:?\s*([\d,]+)/],
      ["광역시", /광역시\s*:?\s*([\d,]+)/],
      ["그 밖의 지역", /그\s*밖의\s*지역은?\s*:?\s*([\d,]+)/],
    ] as const) {
      const m = 숙박cell.원문.match(re);
      if (m) caps.push({ 지역: label, amount: Number(m[1].replace(/,/g, "")) });
    }
    domestic.push({
      그룹: head, 호: hoNumbers(head),
      철도운임: clean(철도), 선박운임: clean(선박), 항공운임: clean(항공), 자동차운임: clean(자동차),
      일비: cell(일비), 숙박비: 숙박cell, 숙박상한: caps, 식비: cell(식비),
      원문행: cells.map(clean).join(" | "),
    });
  }
  const domesticNotes = a2.split("\n")
    .filter((l) => /^비고|^\d\.\s|^○/.test(l.trim()))
    .map((l) => l.trim())
    .filter((l) => l.length > 6)
    .slice(0, 6);

  // ── 별표 5: 국외 여비 지급표(마크다운 표, 한 칸에 <br>로 4개 등급) ──
  const a5 = annexSection(raw, 5);
  // 단위 표기는 "(단위: 미 달러화($))"처럼 괄호가 중첩돼 있어 줄 전체로 잡는다(원문 그대로)
  const overseasCurrency = a5.match(/^\(단위:\s*(.+)\)\s*$/m)?.[1]?.trim() || "";
  const overseas: OverseasRow[] = [];
  for (const r of mdRows(a5)) {
    if (r.length < 5 || !/별표 1의/.test(r[0])) continue;
    const 그룹 = clean(r[0]).replace(/^\d+\.\s*/, "");
    const 호 = hoNumbers(그룹);
    const split = (s: string) => s.split(/<br\s*\/?>/i).map((x) => x.trim()).filter(Boolean);
    const [등급들, 일비들, 숙박들, 식비들] = [split(r[1]), split(r[2]), split(r[3]), split(r[4])];
    for (let i = 0; i < 등급들.length; i++) {
      const 숙박raw = 숙박들[i] ?? "";
      const capM = 숙박raw.match(/상한액:\s*([\d,]+)/);
      overseas.push({
        그룹, 호, 등급: clean(등급들[i]),
        일비: cell(일비들[i] ?? ""),
        숙박상한: { 원문: clean(숙박raw), amount: capM ? Number(capM[1].replace(/,/g, "")) : null },
        식비: cell(식비들[i] ?? ""),
        원문행: `${그룹} · ${clean(등급들[i])} 등급 | 일비 ${clean(일비들[i] ?? "")} | 숙박비 ${clean(숙박raw)} | 식비 ${clean(식비들[i] ?? "")}`,
      });
    }
  }

  // ── 별표 3: 국외 항공운임 정액표(좌석 등급 — 금액 아님) ──
  const a3 = annexSection(raw, 3);
  const airfare: Airfare[] = [];
  for (const cells of htmlRows(a3)) {
    const vals = cells.map(clean).filter(Boolean);
    if (vals.length < 2) continue;
    const [대상, 등급] = [vals[vals.length - 2], vals[vals.length - 1]];
    if (!/정액|이코노미|비즈니스/.test(등급)) continue;
    airfare.push({ 대상, 호: hoNumbers(대상), 등급, 원문행: `${대상} | ${등급}` });
  }

  // 지역등급 국가표(별표 5의 두 번째 표, HTML)
  const regions: RegionGrade[] = [];
  for (const cells of htmlRows(a5)) {
    const head = clean(cells[0]);
    const m = head.match(/^[“"']?([가나다라])[”"']?\s*등급$/);
    if (!m) continue;
    const 국가 = cells.slice(1).map(clean).join(", ").split(/,\s*/).map((s) => s.trim()).filter(Boolean);
    regions.push({ 등급: m[1], 국가, 원문행: `${head}: ${국가.join(", ")}` });
  }

  // ── 제18조: 근무지 내 국내 출장 정액 ──
  const a18 = article(raw, 18);
  const over = a18.match(/4시간\s*이상인?\s*직원에게는\s*(\d+)만원/);
  const under = a18.match(/4시간\s*미만인?\s*직원에게는\s*(\d+)만원/);
  const inArea = over && under
    ? {
        이상4시간: { 원문: `${over[1]}만원`, amount: Number(over[1]) * 10000 },
        미만4시간: { 원문: `${under[1]}만원`, amount: Number(under[1]) * 10000 },
        원문: firstPara(a18),
      }
    : null;

  // ── 자동 계산에 반영하지 않는 감액·특례(원문 그대로 안내) ──
  const notes: ArticleNote[] = [];
  const a16 = article(raw, 16);
  const a16_3 = a16.split("\n").find((l) => l.trim().startsWith("③"))?.trim();
  const a16_1 = firstPara(a16);
  const a17_1 = firstPara(article(raw, 17));
  if (a16_1) notes.push({ 조: "제16조제1항", 원문: a16_1 });
  if (a16_3) notes.push({ 조: "제16조제3항", 원문: a16_3 });
  if (a17_1) notes.push({ 조: "제17조제1항", 원문: a17_1 });
  if (inArea) notes.push({ 조: "제18조제1항", 원문: inArea.원문 });

  // ── value_store(검수완료 표) 대조 — 국외 지급표 칸이 그대로 있는지 확인만 한다 ──
  let checked = 0;
  const total = overseas.length * 3;
  try {
    const vs = JSON.parse(fs.readFileSync(
      path.resolve(process.cwd(), "..", "tools", "index", "value_store.json"), "utf-8"));
    const bag = (vs.rows || [])
      .filter((r: any) => r?.규정명 === TRAVEL_REG_NAME)
      .map((r: any) => clean(String(r?.값 ?? "")));
    const hit = (v: string) => (v ? bag.some((b: string) => b.includes(v)) : false);
    for (const o of overseas) {
      if (hit(o.일비.원문)) checked++;
      if (hit(o.숙박상한.원문)) checked++;
      if (hit(o.식비.원문)) checked++;
    }
  } catch { /* 인덱스 없음 — 대조 생략(값은 볼트 원문 기준) */ }

  return {
    ok: grades.length > 0 && domestic.length > 0 && overseas.length > 0,
    grades, domestic, domesticNotes, overseas, overseasCurrency, airfare, regions,
    inArea, notes, 개정일, valueStoreChecked: checked, valueStoreTotal: total,
  };
}
