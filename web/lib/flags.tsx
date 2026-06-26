// 기능 플래그(런타임) — 정적 export라 빌드에 박지 않고 백엔드 /api/app/flags에서 받아온다.
// FOUC/장애 안전: 안전 기본값 즉시 렌더 → localStorage 캐시 반영 → 서버값으로 갱신. 실패 시 캐시/기본값 유지.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

// ⛔ 백엔드 FLAG_REGISTRY(app_api.py)와 키를 동기화. 기본값은 항상 '안전한 쪽'(보통 false=기존 동작).
export const FLAG_DEFAULTS: Record<string, boolean> = {
  demo_banner: false,
  cite_highlight: false, // 근거 조문 클릭 시 드로어 하이라이트 + '핵심 근거' 표시 (release 플래그, 만료 2026-07-20)
  graph_split: false, // 관계 그래프 노드 클릭 → 옆 문서 패널(분할 뷰), 그래프 계속 조작 (release 플래그, 만료 2026-07-24)
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
/** 단일 플래그 — 미정의 키는 안전 기본값(false). 예: const on = useFlag("demo_banner") */
export const useFlag = (key: string): boolean =>
  useContext(FlagsCtx)[key] ?? FLAG_DEFAULTS[key] ?? false;
