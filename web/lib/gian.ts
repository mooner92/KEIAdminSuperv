// 기안 도우미(docs/72 P4) — 빌드타임 데이터 공급.
//
// `/approval`은 "누가 결재하나"까지만 답한다. 그 다음 질문("무슨 문서로 · 뭘 첨부 · 기록물철 ·
// 협조냐 결재냐")의 답은 이미 볼트에 있다. 이 파일은 그 답을 모아둔 `tools/index/gian_map.json`
// (01r_gian_map.py, 결정적·LLM 0회)을 읽어 화면에 넘길 뿐이다.
//
// ⛔ 절대 규칙
//  1. 여기서 만드는 사실은 없다. 인덱스가 없으면 `ok:false` → 화면이 "원문 확인"을 안내한다.
//  2. 첨부서류는 규정이 아니라 시스템 노트의 **'첨부 권장'** 서술 → 화면이 `권장` 라벨을 단다.
//  3. 정적 export라 런타임 fetch 불가 — getStaticProps에서만 호출한다.
import fs from "node:fs";
import path from "node:path";

export type GianDoc = string;

export type GianFile = {
  코드: string;
  단위업무: string;
  철명: string;
  보존기간: string;
  근거종류: string;   // "결재정보 주의" | "코드표 고르는 요령"
  매칭어: string[];
  근거: string;       // 그 판단을 낳은 원문 문장 그대로
};

export type GianRule = {
  구분: string;
  업무: string;
  대상: string;
  전결권자: string;
  협의: string;
  원장: boolean;
  원문행: string;
  매칭어: string[];
};

export type GianGroup = {
  id: string;
  이름: string;
  문서종류: GianDoc[];
  확인사항: string[];
  첨부권장: string[];
  결재정보주의: string[];
  기록물철후보: GianFile[];
  전결: GianRule[];
  전결키워드: string[];
  전결매칭어: string[];
};

export type GianArticle = { 규정명: string; slug: string; 조: string; 제목: string; 원문: string };

export type GianRole = {
  역할: string;
  설명: string[];
  규정근거: GianArticle | null;   // 조문 제목에 역할 낱말이 그대로 있는 것만(참조·후열은 null)
};

export type GianMap = {
  ok: boolean;
  generated: string;
  sources: { 문서: string; slug: string; 검수상태: string }[];
  업무군: GianGroup[];
  기록물철: {
    공통: { 코드: string; 단위업무: string; 철명: string; 보존기간: string }[];
    담당예시: { 코드: string; 단위업무: string; 철명: string; 보존기간: string }[];
    요령: string[];
  };
  결재선역할: GianRole[];
  일상감사: { 안내문: string; 적용문서: string[]; 사용방법: string[] };
  편철원칙: string[];
  체크리스트: { 결재올림전: string[]; 첨부확인: string[] };
  규정근거: { 기안문: GianArticle[]; 편철: GianArticle[] };
  서식: { 규정명: string; 호: string; 이름: string; pdf: string | null }[];
};

const EMPTY: GianMap = {
  ok: false, generated: "", sources: [], 업무군: [],
  기록물철: { 공통: [], 담당예시: [], 요령: [] },
  결재선역할: [], 일상감사: { 안내문: "", 적용문서: [], 사용방법: [] },
  편철원칙: [], 체크리스트: { 결재올림전: [], 첨부확인: [] },
  규정근거: { 기안문: [], 편철: [] }, 서식: [],
};

/** tools/index/gian_map.json(01r) 로드. 없으면 ok:false — 빌드는 깨지지 않고 화면이 안내한다. */
export function loadGianMap(): GianMap {
  let raw: Partial<GianMap>;
  try {
    const p = path.resolve(process.cwd(), "..", "tools", "index", "gian_map.json");
    raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return EMPTY;
  }
  if (!raw.업무군?.length) return EMPTY;
  return { ...EMPTY, ...raw, ok: true } as GianMap;
}
