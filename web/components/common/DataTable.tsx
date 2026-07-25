import type { ReactNode } from "react";
import s from "./DataTable.module.css";

/** 표 데이터 공용 컴포넌트(specs/03 B2) — 관리자 표·품질 추이표 등이 공유하는 단 하나의 표 스킨.
 *  · 가로 스크롤·머리행 고정·행 hover·빈 상태를 여기서 책임진다(화면별 사본 금지).
 *  · 열 정의(cols)만 주면 되고, 셀 렌더는 render로 자유(도메인 배지·버튼 그대로 꽂힘).
 *  · num=true면 우측 정렬+자릿수 정렬, wrap=true면 줄바꿈 허용 열. */
export type Col<T> = {
  key: string;
  head: ReactNode;
  render: (row: T, i: number) => ReactNode;
  num?: boolean;
  wrap?: boolean;
};

export default function DataTable<T>({ cols, rows, rowKey, empty = "표시할 항목이 없어요.", caption }: {
  cols: Col<T>[];
  rows: T[];
  rowKey?: (row: T, i: number) => string;
  empty?: ReactNode;
  caption?: ReactNode;
}) {
  if (rows.length === 0) return <p className={s.empty}>{empty}</p>;
  return (
    <div className={s.wrap}>
      <table className={s.table}>
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>{cols.map((c) => <th key={c.key} className={c.num ? s.num : undefined}>{c.head}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : i}>
              {cols.map((c) => (
                <td key={c.key} className={`${c.num ? s.num : ""} ${c.wrap ? s.wrapCell : ""}`.trim() || undefined}>
                  {c.render(r, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
