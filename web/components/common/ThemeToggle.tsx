import { useTheme, type Resolved } from "../../lib/theme";
import styles from "./ThemeToggle.module.css";

// 기본값은 '시스템'(OS 따름, theme.tsx 초기 pref) — 최초엔 OS 테마를 그대로 쓴다.
// 클릭 토글은 라이트↔다크만: 현재 화면(resolved) 기준으로 반대 테마를 '명시' 설정한다.
// (system 상태에서 클릭하면 현재 보이는 것의 반대로, 이후엔 명시값끼리 토글 — 사용자 요청)
const ICON: Record<Resolved, string> = { light: "☀️", dark: "🌙" };
const LABEL: Record<Resolved, string> = { light: "라이트", dark: "다크" };

export default function ThemeToggle() {
  const { resolved, setPref } = useTheme();
  const next: Resolved = resolved === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className={styles.btn}
      onClick={() => setPref(next)}
      title={`테마: ${LABEL[resolved]} · 클릭하면 ${LABEL[next]}(으)로`}
      aria-label={`테마 전환 (현재 ${LABEL[resolved]})`}
    >
      <span className={styles.icon} aria-hidden>{ICON[resolved]}</span>
      <span className={styles.label}>{LABEL[resolved]}</span>
    </button>
  );
}
