// 기능 플래그(런타임) — 정적 export라 빌드에 박지 않고 백엔드 /api/app/flags에서 받아온다.
// FOUC/장애 안전: 안전 기본값 즉시 렌더 → localStorage 캐시 반영 → 서버값으로 갱신. 실패 시 캐시/기본값 유지.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

// ⛔ 백엔드 FLAG_REGISTRY(app_api.py)와 키를 동기화. 기본값은 항상 '안전한 쪽'(보통 false=기존 동작).
export const FLAG_DEFAULTS: Record<string, boolean> = {
  changelog: false, // docs/32: 새로워진 점 — 상단 배너+/changelog 페이지+푸터 링크 (release, 만료 2026-12-31)
  trust_ops: false, // docs/34 ②: 관리자 🛡 신뢰 탭 (release, 만료 2026-12-31)
  forms_registry: false, // docs/34 ①: /forms 서식 찾기 (release, 만료 2026-12-31)
  chat_stop: false, // docs/34 ③: 채팅 ■ 중단 버튼+2단계 대기 표시 (release, 만료 2026-12-31)
  events_tab: false, // docs/35: 지금 KEI에서(/now) — GNB 탭+페이지 (release, 만료 2026-12-31)
  usage_analytics: false, // docs/35 §0: 기능 사용량 수집(allowlist·집계만) (release, 만료 2026-12-31)
  graph_expand_regs: false, // 규정↔규정 준용/참조 1홉 확장 (백엔드 실험 플래그)
  user_directory: false, // docs/29 §4: 관리자 사용자 목록 탭 (release, 만료 2026-12-31)
  trending_keywords: false, // docs/29 §1: 빈 화면 인기 키워드 칩 (release, 만료 2026-12-31)
  help_hub: false, // docs/31: 도움말 허브(잘 묻는 법·FAQ·푸터 FAQ 링크) (release, 만료 2026-12-31)
  source_type_badges: false, // 근거 패널 출처 성격 배지 📜규정(공식)/📘가이드(참고) 구분 (release 플래그, 만료 2026-08-15)
  content_search: false, // 둘러보기 검색 범위 선택(제목·번호·분류·내용) + 원문 내용 전문검색 (release 플래그, 만료 2026-08-31)
  graph_expand_actions: false, // 행위 흐름 확장 — 신청 회수 시 후속 단계(정산·결과보고) 자동첨부 (백엔드, 실험 플래그)
  article_integrity: false, // Track A: 근거 카드 조문 효력 배지(삭제됨/개정일) + 문서 준용·정의어 패널 (release 플래그, 만료 2026-09-30)
  graph_impact: false, // Track C: 문서 드로어 '개정 파급(전이폐포)·함께 보는 조문(공동인용)' 패널 (release 플래그, 만료 2026-09-30)
  deadline_calc: false, // Track B: 문서 드로어 '이 규정의 기한' — 기준일→마감일 계산 + .ics (release 플래그, 만료 2026-10-15)
  approval_finder: false,
  source_card_v2: false,
  answer_actions: false, // v1 ⑫(S6)
  explore_upgrades: false,
  corpus_admin: false, // v1.1 P1: /admin 코퍼스 관리(목록·제외 토글) (release, 만료 2026-12-15) // v1 ⑬⑭(S7): URL 딥링크·드로어 뒤로·TOC·그래프 검색 (release, 만료 2026-11-30)
  table_restore: false, // docs/24: /admin 표 복원 검수 탭(01p 제안 열람·반영) (release, 만료 2026-12-31)
  journey_map: false, // docs/25: 업무 한 장(스윔레인 여정) 페이지+GNB (release, 만료 2026-12-31)
  followup_suggest: false, // docs/26: 답변 후속 질문 칩(무LLM) (release, 만료 2026-12-31)
  select_ask: false, // docs/26: 원문 선택 질문 팝오버 (release, 만료 2026-12-31)
};
const CACHE_KEY = "kei-flags";

type Flags = Record<string, boolean>;
const FlagsCtx = createContext<Flags>(FLAG_DEFAULTS);

function readCache(): Flags {
  if (typeof window === "undefined") return FLAG_DEFAULTS;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? { ...FLAG_DEFAULTS, ...JSON.parse(raw) } : FLAG_DEFAULTS;
  } catch {
    return FLAG_DEFAULTS;
  }
}

export function FlagsProvider({ children }: { children: ReactNode }) {
  // 초기값=기본값(빌드 HTML과 일치 → 하이드레이션 안전). 마운트 후 캐시→서버값 순으로 갱신.
  const [flags, setFlags] = useState<Flags>(FLAG_DEFAULTS);
  useEffect(() => {
    setFlags(readCache());
    api
      .flags()
      .then((f) => {
        // 드리프트 감지: 서버에 있으나 프론트 FLAG_DEFAULTS에 없는 키 경고(키 동기화 누락 조기 발견)
        const missing = Object.keys(f).filter((k) => !(k in FLAG_DEFAULTS));
        if (missing.length) console.warn("[flags] FLAG_DEFAULTS에 없는 키(동기화 필요):", missing);
        setFlags({ ...FLAG_DEFAULTS, ...f });
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(f));
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        /* 백엔드 실패 시 캐시/기본값 유지(화면 안 멈춤) */
      });
  }, []);
  return <FlagsCtx.Provider value={flags}>{children}</FlagsCtx.Provider>;
}

export const useFlags = () => useContext(FlagsCtx);
/** 단일 플래그 — 미정의 키는 안전 기본값(false). 예: const on = useFlag("changelog") */
export const useFlag = (key: string): boolean =>
  useContext(FlagsCtx)[key] ?? FLAG_DEFAULTS[key] ?? false;
