import Link from "next/link";
import Section from "../common/Section";
import ResultRow, { ResultList, RowChip, RowTag, RowBadge } from "../common/ResultRow";
import Fold from "./Fold";
import ArticleNotes from "./ArticleNote";
import type { GianGroup, GianMap } from "../../lib/gian";
import s from "./Gian.module.css";

/** ⓒ 어디에 편철하나(기록물철).
 *  첫 화면 = 후보 1~2건(코드·보존기간·왜 걸렸는지 근거 문장) — 후보는 몇 건 안 되고,
 *  "왜 이 철인가"가 곧 신뢰라 근거 문장은 접지 않는다.
 *  접기 = 편철 선택 원칙 전문 · 기록물관리규정 제11·14조 원문. */
export default function FileSection({ id, group, principles, articles, commonSrc, codeSrc }: {
  id: string;
  group: GianGroup;
  principles: string[];
  articles: GianMap["규정근거"]["편철"];
  commonSrc?: GianMap["sources"][number];
  codeSrc?: GianMap["sources"][number];
}) {
  const link = (x?: GianMap["sources"][number]) =>
    x?.slug ? <Link href={`/d/${x.slug}/`}>{x.문서}</Link> : <b>{x?.문서}</b>;
  return (
    <Section id={id} icon="🗂" title="어디에 편철하나" badge={group.기록물철후보.length}
      actions={<span className={s.soft}>후보</span>}
      desc="공통 단위업무(ZA) 기준 후보입니다. 부서 고유 업무의 (담당) 코드는 부서마다 달라 기안 화면 편철 팝업에서 직접 확인합니다.">
      <ResultList empty={group.기록물철후보.length ? undefined : "이 업무군의 기록물철 후보를 찾지 못했습니다 — 기안 화면 편철 팝업에서 확인하세요"}>
        {group.기록물철후보.map((f) => (
          <ResultRow key={`${f.코드}-${f.철명}`}
            lead={<span aria-hidden>📁</span>}
            title={f.철명}
            chips={<><RowChip section="시스템">{f.단위업무}</RowChip>
              <RowTag>{f.코드}</RowTag><RowTag>보존기간 {f.보존기간}</RowTag>
              <span className={s.soft}>{f.근거종류}</span></>}
            snippet={<span className={s.src}>📄 {f.근거}{f.매칭어.length ? ` (일치: ${f.매칭어.join(", ")})` : ""}</span>}
            right={<RowBadge>후보</RowBadge>}
          />
        ))}
      </ResultList>
      {principles.length ? (
        <Fold title="편철 선택 원칙" count={principles.length} unit="줄">
          <ul className={s.checks}>
            {principles.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
          <p className={s.src}>
            📄 출처: {link(commonSrc)} · 코드표: {link(codeSrc)}
          </p>
        </Fold>
      ) : null}
      <Fold title="규정 근거 — 기록물관리규정 제11조·제14조 원문">
        <ArticleNotes items={articles} only={["제11조", "제14조"]} max={400} />
      </Fold>
    </Section>
  );
}
