import Link from "next/link";
import Section from "../common/Section";
import Fold from "./Fold";
import type { GianGroup, GianMap } from "../../lib/gian";
import s from "./Gian.module.css";

/** ⓑ 무엇을 첨부하나.
 *  ⛔ 절대 규칙(단정 금지): 이 목록은 규정이 아니라 전자결재 안내 문서의 '첨부 권장' 서술이다.
 *     그래서 제목 옆 `권장` 라벨과 설명 문장을 **접지 않고** 항상 보여준다.
 *  접기 = 첨부 확인 체크리스트 전문. */
export default function AttachSection({ id, group, checklist, src }: {
  id: string; group: GianGroup; checklist: string[]; src?: GianMap["sources"][number];
}) {
  return (
    <Section id={id} icon="📎" title="무엇을 첨부하나" badge={group.첨부권장.length}
      actions={<span className={s.soft}>권장</span>}
      desc="규정이 아니라 전자결재 안내 문서의 '첨부 권장' 항목입니다 — 실제 필요 서류는 업무·금액에 따라 다릅니다.">
      {group.첨부권장.length ? (
        <ul className={s.chips}>
          {group.첨부권장.map((a) => <li key={a} className={s.chip}>{a}</li>)}
        </ul>
      ) : (
        <p className={s.missing}>이 업무군의 첨부 권장 항목을 찾지 못했습니다 — 원문 확인</p>
      )}
      {checklist.length ? (
        <Fold title="첨부 확인 체크리스트" count={checklist.length}>
          <ul className={s.checks}>
            {checklist.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
          <p className={s.src}>
            📄 출처: {src?.slug ? <Link href={`/d/${src.slug}/`}>{src.문서}</Link> : <b>{src?.문서}</b>}
          </p>
        </Fold>
      ) : null}
    </Section>
  );
}
