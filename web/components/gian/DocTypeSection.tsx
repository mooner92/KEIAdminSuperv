import Section from "../common/Section";
import Fold from "./Fold";
import ArticleNotes from "./ArticleNote";
import type { GianGroup, GianMap } from "../../lib/gian";
import s from "./Gian.module.css";

/** ⓐ 어떤 문서로 기안하나.
 *  첫 화면 = 문서종류 칩 + 기안문 서식 한 줄(짧고 바로 쓰는 것).
 *  접기 = 기안문 확인 항목 · 규정 근거 조문 원문(문서관리규정 제15·22조). */
export default function DocTypeSection({ id, group, articles, forms }: {
  id: string; group: GianGroup; articles: GianMap["규정근거"]["기안문"]; forms: GianMap["서식"];
}) {
  return (
    <Section id={id} icon="📄" title="어떤 문서로 기안하나" badge={group.문서종류.length}
      desc={`${group.이름}에서 쓰는 전자결재 문서종류입니다.`}>
      <ul className={s.chips}>
        {group.문서종류.map((d) => <li key={d} className={s.chip}>{d}</li>)}
      </ul>
      {forms.length ? (
        <p className={s.src} style={{ marginTop: 10 }}>
          📎 기안문 서식:{" "}
          {forms.map((f, i) => (
            <span key={f.호}>
              {i > 0 ? " · " : ""}
              {f.pdf ? <a href={f.pdf} target="_blank" rel="noreferrer">{f.규정명} {f.호}</a> : `${f.규정명} ${f.호}`}
            </span>
          ))}{" "}
          (별지 제1호=전자문서 · 별지 제2호=내부결재문서)
        </p>
      ) : null}

      {group.확인사항.length ? (
        <Fold title="기안문에서 확인할 항목" count={group.확인사항.length} unit="가지">
          <ul className={s.chips}>
            {group.확인사항.map((c, i) => <li key={i} className={s.chip}>{c}</li>)}
          </ul>
        </Fold>
      ) : null}
      <Fold title="규정 근거 — 문서관리규정 제15조·제22조 원문" >
        <ArticleNotes items={articles} only={["제15조", "제22조"]} max={400} />
      </Fold>
    </Section>
  );
}
