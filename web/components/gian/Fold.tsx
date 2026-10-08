import type { ReactNode } from "react";
import s from "./Gian.module.css";

/** 접기 한 벌 — 기안 도우미의 "핵심 먼저, 원문은 접어서" 규약을 한 곳에서 구현한다.
 *
 *  ⛔ 절대 규칙 4(정보는 지우지 않는다): 조문 원문·체크리스트 전문·편철 원칙은 **삭제가 아니라
 *     접기**로 내린다. 그래서 이 컴포넌트는 `<details>` — 브라우저 찾기(Ctrl+F)·스크린리더가
 *     summary를 읽고, 펼치면 원문이 **그대로** 나온다(요약·의역 없음).
 *  요약줄에 건수를 달아 "접힌 안에 무엇이 몇 개 있는지"를 닫힌 상태에서도 말한다. */
export default function Fold({ title, count, unit = "건", children, defaultOpen }: {
  title: string;
  count?: number;
  unit?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className={s.fold} open={defaultOpen}>
      <summary className={s.foldSum}>
        <span className={s.foldCaret} aria-hidden>▸</span>
        <span className={s.foldTitle}>{title}</span>
        {count ? <span className={s.foldCount}>{count}{unit}</span> : null}
      </summary>
      <div className={s.foldBody}>{children}</div>
    </details>
  );
}
