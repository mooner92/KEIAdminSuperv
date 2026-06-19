import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

// 테마 시스템 — 사용자 선호(라이트/다크/시스템)를 보관하고, 실제 적용값(resolved)을
// <html data-theme>로 내려 globals.css의 [data-theme="dark"] 토큰을 분기시킨다.
// "system"은 prefers-color-scheme를 따라간다(OS 변경 시 실시간 반영).
export type ThemePref = "light" | "dark" | "system";
export type Resolved = "light" | "dark";

const KEY = "kei-theme";

type Ctx = { pref: ThemePref; resolved: Resolved; setPref: (p: ThemePref) => void };
const ThemeCtx = createContext<Ctx>({ pref: "system", resolved: "light", setPref: () => {} });
export const useTheme = () => useContext(ThemeCtx);

function systemDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function resolve(p: ThemePref): Resolved {
  return p === "system" ? (systemDark() ? "dark" : "light") : p;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>("system");
  const [resolved, setResolved] = useState<Resolved>("light");

  // 마운트 시 저장된 선호 읽기(_document 인라인 스크립트가 이미 data-theme는 적용해 둠)
  useEffect(() => {
    const stored = (typeof localStorage !== "undefined" && localStorage.getItem(KEY)) as ThemePref | null;
    if (stored === "light" || stored === "dark" || stored === "system") setPrefState(stored);
  }, []);

  // 선호 변경 → 적용값 계산 → <html data-theme> 반영 + 저장
  useEffect(() => {
    const r = resolve(pref);
    setResolved(r);
    document.documentElement.dataset.theme = r;
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      /* ignore */
    }
  }, [pref]);

  // 시스템 모드일 때 OS 테마 변경 실시간 반영
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const r: Resolved = mq.matches ? "dark" : "light";
      setResolved(r);
      document.documentElement.dataset.theme = r;
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  const setPref = useCallback((p: ThemePref) => setPrefState(p), []);
  return <ThemeCtx.Provider value={{ pref, resolved, setPref }}>{children}</ThemeCtx.Provider>;
}
