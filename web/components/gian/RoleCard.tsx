import Link from "next/link";
import type { GianRole } from "../../lib/gian";
import s from "./Gian.module.css";

const ICON = (role: string) =>
  role.startsWith("협조") ? "🤝" : role === "참조" || role === "후열" ? "👀" : "✅";

/** 결재선 역할 한 장 — "협조냐 결재냐"에 답하는 카드(컴팩트판).
 *  ⛔ 절대 규칙1: 설명은 시스템 노트 원문, 규정 근거는 조문 제목이 그 역할을 그대로 말하는
 *     조문만 붙인다. 근거가 없는 역할(참조·후열)은 **없다고 말한다** — 지어내지 않는다.
 *  카드에는 조문 **링크**만 두고 조문 원문은 섹션 접기로 내렸다(삭제 아님 — RoleSection). */
export default function RoleCard({ role }: { role: GianRole }) {
  const g = role.규정근거;
  return (
    <li className={s.role}>
      <div className={s.roleName}>
        <span aria-hidden>{ICON(role.역할)}</span>
        {role.역할}
      </div>
      <ul className={s.roleDesc}>
        {role.설명.map((d, i) => <li key={i}>{d}</li>)}
      </ul>
      <p className={s.roleSrc}>
        {g ? (
          <Link href={`/d/${g.slug}/`}>📄 <b>{g.규정명} {g.조}</b>({g.제목})</Link>
        ) : (
          <span className={s.roleNone}>이 역할을 규정 조문에서 확인하지 못했습니다 — 원문·담당 부서 확인</span>
        )}
      </p>
    </li>
  );
}
