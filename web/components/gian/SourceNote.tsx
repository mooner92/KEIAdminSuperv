import Section from "../common/Section";
import Fold from "./Fold";
import type { GianGroup, GianMap } from "../../lib/gian";
import s from "./Gian.module.css";

/** 마무리 — 결재올림 전 최종 확인(접기) + 출처·면책(항상 보임).
 *  ⛔ 절대 규칙 3(출처·면책 유지): 면책 문단과 업무군별 주의는 **접지 않는다**.
 *     접는 것은 11줄짜리 체크리스트 전문뿐이다. */
export default function SourceNote({ id, group, checklist, sources }: {
  id: string; group: GianGroup; checklist: string[]; sources: GianMap["sources"];
}) {
  return (
    <Section id={id} icon="🧷" title="결재 올리기 전에" desc="출처와 한계를 함께 확인하세요.">
      {checklist.length ? (
        <Fold title="결재올림 전 최종 확인" count={checklist.length}>
          <ul className={s.checks}>
            {checklist.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </Fold>
      ) : null}
      {group.결재정보주의.length ? (
        <div className={s.callout} style={{ marginTop: 12 }}>
          <b>⚠ {group.이름} 주의</b>
          <ul className={s.checks}>
            {group.결재정보주의.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      ) : null}
      <p className={s.disclaimer}>
        이 화면은 볼트에 적힌 <b>전자결재 안내 문서·문서관리규정·기록물관리규정·위임전결규정</b>을 모아 보여줄 뿐,
        내용을 새로 만들지 않습니다. <b>첨부서류는 &apos;권장&apos;</b>이고 <b>기록물철은 &apos;후보&apos;</b>입니다 —
        실제 필요 서류·편철·결재선은 업무와 금액, 부서 사정에 따라 다를 수 있으니
        기안 화면과 담당 부서에서 최종 확인하세요.
        <br />📄 근거 문서: {sources.map((x) => x.문서).join(" · ")}
      </p>
    </Section>
  );
}
