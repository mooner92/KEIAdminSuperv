// 금액 구간 판정 — 클라이언트 순수 로직(specs/06 D2).
// ⛔ 구간표를 브라우저에서 다시 파싱하지 않는다. 서버 01r2가 **무결성 검사(겹침=빌드 실패)와
//    사다리 정규화**를 마친 amount_rules.json이 유일한 진실원천이고, 여기서는 조회만 한다.

export type AmountRange = {
  min: number | null; max: number | null; min_incl: boolean; max_incl: boolean;
  표기: string; 전결권자: string; 협의?: string; 원장?: boolean; 대상?: string;
  근거?: { 원문행?: string; 출처?: string };
};
export type AmountRules = Record<string, { 구분: string; 업무경로: string; 구간: AmountRange[] }>;

/** 표기에서 사다리 정규화 주석을 뗀 원문 세그먼트(규칙 매칭 키) */
const bare = (표기: string) => 표기.split("(사다리 절단")[0].trim();

/** 금액 문구가 들어간 세그먼트인가 — 업무 경로의 마지막 조각 판정용 */
export const hasAmount = (seg: string) => /[\d,]+\s*(억|만)?\s*원?\s*(이하|초과|이상|미만)/.test(seg);

/** 업무 문자열 → { key, seg } — 01r2의 키 규칙(구분 > 마지막 세그먼트 제외 경로)과 동일 */
export function splitWork(구분: string, 업무: string): { key: string; seg: string } | null {
  const segs = 업무.split(">").map((s) => s.trim());
  const seg = segs[segs.length - 1];
  if (!hasAmount(seg)) return null;
  const base = segs.slice(0, -1).join(" > ").trim() || 업무;
  return { key: `${구분} > ${base}`, seg };
}

export function covers(r: AmountRange, won: number): boolean {
  if (r.min !== null && (won < r.min || (won === r.min && !r.min_incl))) return false;
  if (r.max !== null && (won > r.max || (won === r.max && !r.max_incl))) return false;
  return true;
}

/** 이 규칙이 금액 축을 가지는가 + 입력 금액에 해당하는가.
 *  반환: null=금액 무관 규칙(항상 유지) · {hit,range}=금액 규칙(hit로 필터) */
export function amountVerdict(
  rules: AmountRules, 구분: string, 업무: string, won: number | null,
): { hit: boolean; range?: AmountRange } | null {
  const sw = splitWork(구분, 업무);
  if (!sw) return null;                       // 금액 구간 없는 업무 — 금액 입력과 무관
  if (won === null) return { hit: true };     // 금액 미입력 — 전부 표시
  const ent = rules[sw.key];
  if (!ent) return { hit: true };             // 룰 테이블 미등록(01r2 unparsed 등) — 숨기지 않는다
  const mine = ent.구간.find((g) => bare(g.표기) === sw.seg);
  if (!mine) return { hit: true };
  return { hit: covers(mine, won), range: mine };
}

/** "370만", "1,000만원", "3억", "500000" → 원 단위. 빈 입력·해석 불가 → null */
export function parseAmountInput(text: string): number | null {
  const t = (text || "").replace(/\s/g, "");
  if (!t) return null;
  const m = t.match(/^([\d,]+(?:\.\d+)?)(억|만)?원?$/);
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(v)) return null;
  return Math.round(v * (m[2] === "억" ? 100_000_000 : m[2] === "만" ? 10_000 : 1));
}

/** 3,700,000 → "370만원" (읽기 쉬운 한국어 금액) */
export function formatWon(won: number): string {
  if (won >= 100_000_000) {
    const 억 = Math.floor(won / 100_000_000);
    const 만 = Math.floor((won % 100_000_000) / 10_000);
    return `${억}억${만 ? ` ${만.toLocaleString()}만` : ""}원`;
  }
  if (won >= 10_000 && won % 10_000 === 0) return `${(won / 10_000).toLocaleString()}만원`;
  return `${won.toLocaleString()}원`;
}
