import Link from "next/link";
import type { GianGroup, GianMap } from "../../lib/gian";
import s from "./Gian.module.css";

/** 업무군 선택 pill + 출처 한 줄 — 화면의 유일한 '입력'.
 *  다른 섹션은 전부 이 선택의 결과를 보여줄 뿐이다. */
export default function TaskPicker({ groups, current, onPick, src }: {
  groups: GianGroup[];
  current: GianGroup;
  onPick: (id: string) => void;
  src?: GianMap["sources"][number];
}) {
  return (
    <>
      <div className={s.picker} role="group" aria-label="업무군 선택">
        {groups.map((x) => (
          <button key={x.id} type="button" aria-pressed={x.id === current.id}
            className={x.id === current.id ? `${s.pick} ${s.pickOn}` : s.pick} onClick={() => onPick(x.id)}>
            {x.id}
          </button>
        ))}
      </div>
      <p className={s.src} style={{ marginTop: 10 }}>
        📄 출처: {src?.slug ? <Link href={`/d/${src.slug}/`}>{src.문서}</Link> : <b>{src?.문서}</b>}
        {src?.검수상태 ? ` · ${src.검수상태}` : ""} — 그룹웨어(G-ProOne) 전자결재 화면 기준 안내입니다.
      </p>
    </>
  );
}
