import type { ReactNode } from "react";
import s from "./Section.module.css";

// 공용 섹션 컨테이너(2026-07-19, 사용자 "flat·둥둥 떠다님" 지적) — 관리자 화면의 모든 묶음이
// 이 패널로 감싸진다: 패널 톤(--color-bg-subtle) 위에 surface 카드가 떠서 "여기부터 여기까지가
// 한 섹션"이 배경으로 구분되고, 제목은 크고 볼드하게(19px/800) 위계를 만든다.
// 액션(버튼·요약 수치)은 제목 줄 우측 정렬. PagedList와 짝지어 쓰는 것이 관례.
export default function Section({ id, icon, title, badge, actions, desc, children }: {
  /** 화면 안 이동(요약 카드 → 섹션 스크롤)용 앵커 id — 선택. */
  id?: string;
  icon: string; title: string; badge?: number;
  actions?: ReactNode; desc?: ReactNode; children: ReactNode;
}) {
  return (
    <section className={s.section} id={id}>
      <header className={s.head}>
        <h2 className={s.title}>
          <span aria-hidden>{icon}</span> {title}
          {badge && badge > 0 ? <span className={s.badge}>{badge}</span> : null}
        </h2>
        {actions ? <div className={s.actions}>{actions}</div> : null}
      </header>
      {desc ? <p className={s.desc}>{desc}</p> : null}
      {children}
    </section>
  );
}
