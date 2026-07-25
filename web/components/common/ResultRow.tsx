import type { ReactNode } from "react";
import s from "./BrowseUI.module.css";

/** 결과 목록 컨테이너 — 카드형 리스트(스크롤은 이 요소가 담당). */
export function ResultList({ children, listRef, empty }: {
  children: ReactNode; listRef?: React.Ref<HTMLUListElement>; empty?: ReactNode;
}) {
  return (
    <ul className={s.list} ref={listRef}>
      {children}
      {empty ? <li className={s.empty}>{empty}</li> : null}
    </ul>
  );
}

/** 목록 한 행 — 정본은 '문서' 탭(Explorer)의 [번호 | 본문(제목·칩·스니펫) | 우측(메타·배지)] 3열.
 *  lead 없으면 2열로 축소. onClick이 있으면 버튼, href면 링크, 둘 다 없으면 정적 행. */
export default function ResultRow({
  lead, title, chips, snippet, body, right, onClick, href, ariaLabel,
}: {
  lead?: ReactNode;
  title: ReactNode;
  chips?: ReactNode;
  snippet?: ReactNode;
  /** 행 안의 도메인 전용 영역(예: 기한 사전의 기준일 계산기) — 제목 블록 아래 전폭. */
  body?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  href?: string;
  ariaLabel?: string;
}) {
  const cls = `${s.row} ${lead === undefined ? s.rowNoLead : ""} ${!onClick && !href ? s.rowStatic : ""}`;
  const inner = (
    <>
      {lead !== undefined ? <span className={s.lead}>{lead}</span> : null}
      <span className={s.main}>
        <span className={s.title}>{title}</span>
        {chips ? <span className={s.sub}>{chips}</span> : null}
        {snippet ? <span className={s.snippet}>{snippet}</span> : null}
        {body ? <span className={s.body}>{body}</span> : null}
      </span>
      {right ? <span className={s.right}>{right}</span> : null}
    </>
  );
  return (
    <li>
      {onClick ? (
        <button className={cls} onClick={onClick} aria-label={ariaLabel}>{inner}</button>
      ) : href ? (
        <a className={cls} href={href} aria-label={ariaLabel}>{inner}</a>
      ) : (
        <div className={cls}>{inner}</div>
      )}
    </li>
  );
}

/** 행 안에서 쓰는 조각들 — 화면별로 같은 모양을 보장(섹션칩·태그·배지·액션링크). */
export const RowChip = ({ children, section }: { children: ReactNode; section?: string }) => (
  <span className={s.chip} data-section={section}>{children}</span>
);
export const RowTag = ({ children }: { children: ReactNode }) => <span className={s.tag}>{children}</span>;
export const RowDate = ({ children }: { children: ReactNode }) => <span className={s.date}>{children}</span>;
export const RowBadge = ({ children, ok }: { children: ReactNode; ok?: boolean }) => (
  <span className={ok ? `${s.badge} ${s.badgeOk}` : s.badge}>{children}</span>
);
export const RowAction = ({ children, href, onClick, download, title, muted }: {
  children: ReactNode; href?: string; onClick?: () => void; download?: boolean; title?: string; muted?: boolean;
}) => {
  const cls = `${s.action} ${muted ? s.actionMuted : ""}`;
  if (href) {
    return (
      <a className={cls} href={href} download={download} title={title}
        onClick={(e) => { e.stopPropagation(); onClick?.(); }}>{children}</a>
    );
  }
  if (onClick) {  // 페이지 점프 없는 액션(원문 드로어 등) — href="#" 금지
    return (
      <button type="button" className={cls} title={title}
        onClick={(e) => { e.stopPropagation(); onClick(); }}>{children}</button>
    );
  }
  return <span className={`${s.action} ${s.actionMuted}`} title={title}>{children}</span>;
};
export const rowHl = s.hl;
