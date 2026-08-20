import Section from "../common/Section";
import RoleCard from "./RoleCard";
import Fold from "./Fold";
import { ArticleNote } from "./ArticleNote";
import type { GianMap } from "../../lib/gian";
import s from "./Gian.module.css";

/** ⓓ 누가 결재선에 들어가나 — 역할(결재·전결·대결·협조·참조·후열).
 *  첫 화면 = 일상감사 경고(⚠ 놓치면 반려되는 것이라 접지 않는다) + 역할 카드(설명 + 조문 링크).
 *  접기 = 역할 근거 조문 원문. */
export default function RoleSection({ id, roles, audit }: {
  id: string; roles: GianMap["결재선역할"]; audit: GianMap["일상감사"];
}) {
  // 같은 조문이 여러 역할의 근거일 수 있다(협조 순차·병렬 → 제26조) — 원문은 한 번만 보인다.
  const articles = Array.from(
    new Map(roles.map((r) => r.규정근거).filter((a): a is NonNullable<typeof a> => !!a)
      .map((a) => [`${a.규정명} ${a.조}`, a])).values());
  return (
    <Section id={id} icon="👥" title="누가 결재선에 들어가나" badge={roles.length}
      desc="결재선 설정 팝업에서 고르는 역할입니다. 설명은 전자결재 안내 문서, 근거는 문서관리규정 조문입니다.">
      {audit.안내문 ? (
        <div className={s.callout}>
          <b>⚠ 일상감사신청</b> — {audit.안내문}
          {audit.적용문서.length ? <><br />적용: {audit.적용문서.join(" · ")}</> : null}
        </div>
      ) : null}
      <ul className={s.roles}>
        {roles.map((r) => <RoleCard key={r.역할} role={r} />)}
      </ul>
      {articles.length ? (
        <Fold title="역할 근거 조문 원문" count={articles.length} unit="조">
          <ul className={s.notes}>
            {articles.map((a) => <ArticleNote key={`${a.규정명}${a.조}`} a={a} max={400} />)}
          </ul>
        </Fold>
      ) : null}
      {audit.사용방법.length ? (
        <Fold title="일상감사선 지정 방법" count={audit.사용방법.length} unit="단계">
          <ul className={s.checks}>
            {audit.사용방법.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </Fold>
      ) : null}
    </Section>
  );
}
