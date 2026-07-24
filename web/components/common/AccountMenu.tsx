import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "../../lib/auth";
import { useTheme, type ThemePref } from "../../lib/theme";
import s from "./AccountMenu.module.css";

// 계정 메뉴(2026-07-24, 사용자 요청) — 헤더 아바타 클릭 팝오버.
// 이메일·관리자 배지 · 테마 전환(라이트/다크/시스템, 헤더 토글 흡수) · 로그아웃 · 관리자 바로가기.
// ⛔ 순수 프리젠테이션 + 기존 auth/theme 훅만 사용(신규 백엔드 없음).
const THEMES: { key: ThemePref; icon: string; label: string }[] = [
  { key: "light", icon: "☀", label: "라이트" },
  { key: "dark", icon: "🌙", label: "다크" },
  { key: "system", icon: "🖥", label: "시스템" },
];

export default function AccountMenu() {
  const { user, logout } = useAuth();
  const { pref, setPref } = useTheme();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;
  const initial = (user.username || "?").trim().charAt(0).toUpperCase();

  return (
    <div className={s.wrap} ref={wrapRef}>
      <button className={s.avatar} onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu" aria-expanded={open} title={user.username}>
        {initial}
      </button>
      {open ? (
        <div className={s.pop} role="menu">
          <div className={s.head}>
            <span className={s.avatarLg}>{initial}</span>
            <div className={s.headInfo}>
              <b className={s.email}>{user.username}</b>
              {user.is_admin ? <span className={s.adminTag}>관리자</span> : <span className={s.role}>사용자</span>}
            </div>
          </div>
          <div className={s.section}>
            <span className={s.secLabel}>테마</span>
            <div className={s.themeRow}>
              {THEMES.map((t) => (
                <button key={t.key}
                  className={`${s.themeBtn} ${pref === t.key ? s.themeOn : ""}`}
                  onClick={() => setPref(t.key)} aria-pressed={pref === t.key}>
                  <span aria-hidden>{t.icon}</span>{t.label}
                </button>
              ))}
            </div>
          </div>
          {user.is_admin ? (
            <button className={s.item} role="menuitem"
              onClick={() => { setOpen(false); router.push("/admin/"); }}>
              🛠 관리자 페이지
            </button>
          ) : null}
          <button className={`${s.item} ${s.logout}`} role="menuitem"
            onClick={() => { setOpen(false); logout(); }}>
            ⎋ 로그아웃
          </button>
        </div>
      ) : null}
    </div>
  );
}
