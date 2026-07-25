import { useEffect, useRef, type ReactNode } from "react";
import s from "./SideDrawer.module.css";

/** 우측 사이드 패널 공용 껍데기(2026-07-25) — 문서 드로어와 같은 형태·모션.
 *  열림 상태에서 Esc·배경 클릭으로 닫히고, 열릴 때 패널로 포커스를 옮긴다(접근성).
 *  내용(children)과 상단 액션(actions)은 화면별 자유 — 껍데기만 공유한다. */
export default function SideDrawer({ open, title, subtitle, actions, children, onClose, ariaLabel }: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  ariaLabel?: string;
}) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div className={`${s.overlay} ${open ? s.open : ""}`} aria-hidden={!open}>
      <div className={s.backdrop} onClick={onClose} />
      <aside
        ref={panelRef}
        tabIndex={-1}
        className={s.panel}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || (typeof title === "string" ? title : "패널")}
      >
        <div className={s.bar}>
          <div className={s.titleWrap}>
            <div className={s.title}>{title}</div>
            {subtitle ? <div className={s.sub}>{subtitle}</div> : null}
          </div>
          <div className={s.barActions}>
            {actions}
            <button type="button" className={s.close} onClick={onClose} aria-label="닫기">✕</button>
          </div>
        </div>
        <div className={s.body}>{open ? children : null}</div>
      </aside>
    </div>
  );
}
