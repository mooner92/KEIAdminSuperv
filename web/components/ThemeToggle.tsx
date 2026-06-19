import { useTheme, type ThemePref } from "../lib/theme";
import styles from "./ThemeToggle.module.css";

// 라이트 → 다크 → 시스템 순환 토글
const NEXT: Record<ThemePref, ThemePref> = { light: "dark", dark: "system", system: "light" };
const ICON: Record<ThemePref, string> = { light: "☀️", dark: "🌙", system: "🖥️" };
const LABEL: Record<ThemePref, string> = { light: "라이트", dark: "다크", system: "시스템" };

export default function ThemeToggle() {
  const { pref, setPref } = useTheme();
  return (
    <button
      type="button"
      className={styles.btn}
      onClick={() => setPref(NEXT[pref])}
      title={`테마: ${LABEL[pref]} · 클릭하면 ${LABEL[NEXT[pref]]}(으)로`}
      aria-label={`테마 전환 (현재 ${LABEL[pref]})`}
    >
      <span className={styles.icon} aria-hidden>
        {ICON[pref]}
      </span>
      <span className={styles.label}>{LABEL[pref]}</span>
    </button>
  );
}
