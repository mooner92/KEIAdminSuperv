import Link from "next/link";
import type { GianRole } from "../../lib/gian";
import s from "./Gian.module.css";

/** 결재선 역할 한 장 — "협조냐 결재냐"에 답하는 카드.
 *  ⛔ 절대 규칙1: 설명은 시스템 노트 원문, 규정 근거는 조문 제목이 그 역할을 그대로 말하는
 *     조문만 붙인다. 근거가 없는 역할(참조·후열)은 **없다고 말한다** — 지어내지 않는다. */
export default function RoleCard({ role }: { role: GianRole }) {
  const g = role.규정근거;
  return (
    <li className={s.role}>
      <div className={s.roleName}>
        <span aria-hidden>{role.역할.startsWith("협조") ? "🤝" : role.역할 === "참조" || role.역할 === "후열" ? "👀" : "✅"}</span>
        {role.역할}
      </div>
      <ul className={s.roleDesc}>
        {role.설명.map((d, i) => <li key={i}>{d}</li>)}
      </ul>
      <p className={s.roleSrc}>
        {g ? (
          <>
            📄 <Link href={`/d/${g.slug}/`}><b>{g.규정명} {g.조}</b>({g.제목})</Link> — {g.원문.slice(0, 90)}
            {g.원문.length > 90 ? "…" : ""}
          </>
        ) : (
          <span className={s.roleNone}>이 역할을 규정 조문에서 확인하지 못했습니다 — 원문·담당 부서 확인</span>
        )}
      </p>
    </li>
  );
}
