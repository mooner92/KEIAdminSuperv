import Link from "next/link";
import Section from "../common/Section";
import PagedList from "../common/PagedList";
import ResultRow, { ResultList, RowChip, RowTag, RowBadge } from "../common/ResultRow";
import type { GianGroup, GianRule } from "../../lib/gian";
import s from "./Gian.module.css";

/** ⓔ 이 업무의 전결권자 — 위임전결규정 별표에서 업무군 낱말로 찾은 규칙.
 *  회계 업무군은 71건이라 기본 5건만 펼쳐 두고 나머지는 페이저로 넘긴다(끝없는 스크롤 제거).
 *  각 행의 근거(별표 원문행)는 남긴다 — 왜 이 규칙인지가 곧 신뢰다. */
export default function ApprovalSection({ id, group, rules, ranks, rank, onRank }: {
  id: string; group: GianGroup; rules: GianRule[];
  ranks: string[]; rank: string; onRank: (r: string) => void;
}) {
  return (
    <Section id={id} icon="⚖" title="이 업무의 전결권자" badge={group.전결.length}
      desc="위임전결규정 별표 기준입니다 — 실무 결재선은 부서마다 다를 수 있어요."
      actions={<Link href="/approval/" className={s.src}>결재선 판정기에서 더 보기 →</Link>}>
      <PagedList
        items={rules} unit="건" sizes={[5, 20, 50]} defaultSize={5} resetKey={`${group.id}|${rank}`}
        note={group.전결매칭어.length ? `일치 낱말: ${group.전결매칭어.join(", ")}` : undefined}
        empty="이 조건에 맞는 전결 규칙이 없어요 — 직급 필터를 풀어보세요."
        filterSlot={ranks.length ? (
          <label className={s.filter}>
            내 직급
            <select className={s.sel} value={rank} onChange={(e) => onRank(e.target.value)} aria-label="직급 필터">
              <option value="">전체</option>
              {ranks.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        ) : undefined}
      >
        {(paged) => (
          <ResultList>
            {paged.map((r, i) => (
              <ResultRow key={`${r.구분}|${r.업무}|${r.대상}|${i}`}
                title={<>{r.업무}{r.대상 ? <span className={s.src}> · {r.대상}</span> : null}</>}
                chips={<><RowChip section="규정집">{r.구분}</RowChip>
                  {r.협의 ? <RowTag>협의 {r.협의}</RowTag> : null}
                  {r.원장 ? <RowBadge>원장 결재</RowBadge> : null}</>}
                snippet={<span className={s.src}>📄 위임전결규정 별표 — {r.원문행}</span>}
                right={<b>{r.전결권자}</b>}
              />
            ))}
          </ResultList>
        )}
      </PagedList>
    </Section>
  );
}
