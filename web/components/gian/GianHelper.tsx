import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Section from "../common/Section";
import PagedList from "../common/PagedList";
import ResultRow, { ResultList, RowChip, RowTag, RowBadge } from "../common/ResultRow";
import RoleCard from "./RoleCard";
import type { GianMap } from "../../lib/gian";
import s from "./Gian.module.css";

// 기안 도우미(docs/72 P4) — "누가 결재하나"(/approval) **다음** 질문에 답하는 화면.
// 업무를 고르면 ⓐ어떤 문서로 ⓑ무엇을 첨부(권장) ⓒ기록물철 후보 ⓓ결재선 역할 ⓔ전결권자.
//
// ⛔ 절대 규칙
//  1. 화면의 모든 항목은 볼트 문서에서 왔고, 줄마다 출처(문서명·조·원문행)를 함께 보여준다.
//  2. 첨부는 규정이 아니라 시스템 노트의 '첨부 권장' 서술 → `권장` 라벨 + 단정 금지.
//  3. 근거를 못 찾은 자리는 비우고 "원문 확인"을 안내한다(추정 금지).

const PICK_KEY = "kei-gian-group";   // 마지막 업무 선택(여비 계산기 kei-travel-ho와 같은 관례)
const ROLE_KEY = "kei-approval-role"; // 직급 기억은 결재선 판정기와 **같은 키**를 공유한다

export default function GianHelper({ map }: { map: GianMap }) {
  const [gid, setGid] = useState(map.업무군[0]?.id ?? "");
  const [rank, setRank] = useState("");   // 전결 목록 직급 필터("" = 전체)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PICK_KEY);
      if (saved && map.업무군.some((g) => g.id === saved)) setGid(saved);
      const r = localStorage.getItem(ROLE_KEY);
      if (r) setRank(r);
    } catch { /* ignore */ }
  }, [map.업무군]);

  const pick = (id: string) => {
    setGid(id);
    try { localStorage.setItem(PICK_KEY, id); } catch { /* ignore */ }
  };
  const pickRank = (r: string) => {
    setRank(r);
    try { r ? localStorage.setItem(ROLE_KEY, r) : localStorage.removeItem(ROLE_KEY); } catch { /* ignore */ }
  };

  const g = useMemo(() => map.업무군.find((x) => x.id === gid) ?? map.업무군[0], [map.업무군, gid]);
  // ⚠ 위임전결 별표의 leaf가 직급이 아닌 규칙(금액구간 등)은 대상이 **빈 값**이다(01n 분류).
  //   그런 업무군에선 직급 필터 자체를 숨긴다 — 빈 항목만 있는 셀렉트는 고장으로 보인다.
  const ranks = useMemo(
    () => Array.from(new Set((g?.전결 ?? []).map((r) => r.대상).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, "ko")),
    [g],
  );
  // 직급은 결재선 판정기와 키를 공유하므로, 이 업무군에 없는 직급이 저장돼 있을 수 있다.
  // 그 경우 필터를 적용하면 0건이 되어 "규칙이 없다"로 오독된다 → 없는 직급은 무시한다.
  const rules = useMemo(
    () => (g?.전결 ?? []).filter((r) => !rank || !ranks.includes(rank) || r.대상 === rank),
    [g, rank, ranks],
  );

  const src = (name: string) => map.sources.find((x) => x.문서 === name);
  const applySrc = src("전자결재 기안 · 업무별 적용");
  const codeSrc = src("전자결재 기안 · 기록물철 코드표");
  const commonSrc = src("전자결재 기안 · 결재상신 공통");

  if (!map.ok || !g) {
    return (
      <Section icon="⚠️" title="기안 안내표를 읽지 못했습니다">
        <p className={s.src}>
          기안 매핑 인덱스(<b>tools/index/gian_map.json</b>)를 이 화면이 읽지 못했어요.{" "}
          <b>내용을 추정해 보여드리지 않습니다.</b>{" "}
          <Link href="/d/전자결재 기안 · 결재상신 공통/">전자결재 기안 · 결재상신 공통</Link> 문서에서 직접
          확인하시거나 담당 부서에 문의하세요.
        </p>
      </Section>
    );
  }

  const docLink = (name?: string, slug?: string) =>
    name && slug ? <Link href={`/d/${slug}/`}>{name}</Link> : <b>{name}</b>;

  return (
    <>
      <Section icon="🧾" title="어떤 업무의 기안인가요?"
        desc="업무를 고르면 문서종류·첨부(권장)·기록물철·결재선 역할·전결권자를 한 화면에 모아 보여드려요.">
        <div className={s.picker} role="group" aria-label="업무군 선택">
          {map.업무군.map((x) => (
            <button key={x.id} type="button" aria-pressed={x.id === g.id}
              className={x.id === g.id ? `${s.pick} ${s.pickOn}` : s.pick} onClick={() => pick(x.id)}>
              {x.id}
            </button>
          ))}
        </div>
        <p className={s.src} style={{ marginTop: 10 }}>
          📄 출처: {docLink(applySrc?.문서, applySrc?.slug)}
          {applySrc?.검수상태 ? ` · ${applySrc.검수상태}` : ""} — 그룹웨어(G-ProOne) 전자결재 화면 기준 안내입니다.
        </p>
      </Section>

      <Section icon="①" title="어떤 문서로 기안하나" badge={g.문서종류.length}
        desc={`${g.이름}에서 쓰는 전자결재 문서종류입니다.`}>
        <ul className={s.chips}>
          {g.문서종류.map((d) => <li key={d} className={s.chip}>{d}</li>)}
        </ul>
        {g.확인사항.length ? (
          <>
            <p className={s.src} style={{ marginTop: 12 }}><b>기안문에서 확인할 항목</b></p>
            <ul className={s.chips}>
              {g.확인사항.map((c, i) => <li key={i} className={s.chip}>{c}</li>)}
            </ul>
          </>
        ) : null}
        <ul className={s.notes}>
          {/* 조문은 원문 그대로지만 화면에선 앞부분만 — 전문은 문서 링크로(⛔요약·의역 아님, 절단 표시). */}
          {map.규정근거.기안문.filter((a) => ["제22조", "제15조"].includes(a.조)).map((a) => (
            <li key={a.조} className={s.note}>
              <b><Link href={`/d/${a.slug}/`}>{a.규정명} {a.조}</Link>({a.제목})</b> — {a.원문.slice(0, 300)}
              {a.원문.length > 300 ? <> … <Link href={`/d/${a.slug}/`}>원문 보기</Link></> : null}
            </li>
          ))}
        </ul>
        {map.서식.length ? (
          <p className={s.src} style={{ marginTop: 10 }}>
            📎 기안문 서식:{" "}
            {map.서식.map((f, i) => (
              <span key={f.호}>
                {i > 0 ? " · " : ""}
                {f.pdf ? <a href={f.pdf} target="_blank" rel="noreferrer">{f.규정명} {f.호}</a> : `${f.규정명} ${f.호}`}
              </span>
            ))}{" "}
            (별지 제1호=전자문서 · 별지 제2호=내부결재문서)
          </p>
        ) : null}
      </Section>

      <Section icon="②" title="무엇을 첨부하나" badge={g.첨부권장.length}
        desc="아래는 규정이 아니라 전자결재 안내 문서의 '첨부 권장' 항목입니다 — 실제 필요 서류는 업무·금액에 따라 다릅니다.">
        <ResultList empty={g.첨부권장.length ? undefined : "이 업무군의 첨부 권장 항목을 찾지 못했습니다 — 원문 확인"}>
          {g.첨부권장.map((a) => (
            <ResultRow key={a} title={a}
              chips={<><span className={s.soft}>권장</span> <RowChip section="시스템">전자결재 기안 · 업무별 적용</RowChip></>} />
          ))}
        </ResultList>
        {map.체크리스트.첨부확인.length ? (
          <>
            <p className={s.src} style={{ marginTop: 12 }}>
              <b>첨부 확인 체크리스트</b> — 출처: {docLink(commonSrc?.문서, commonSrc?.slug)}
            </p>
            <ul className={s.chips}>
              {map.체크리스트.첨부확인.map((c, i) => <li key={i} className={s.chip}>✔ {c}</li>)}
            </ul>
          </>
        ) : null}
      </Section>

      <Section icon="③" title="기록물철(편철)은 무엇을 고르나" badge={g.기록물철후보.length}
        desc="공통 단위업무(ZA) 기준 후보입니다. 부서 고유 업무는 (담당) 코드에서 골라야 하고, 담당 코드는 부서마다 달라 기안 화면 팝업에서 직접 확인합니다.">
        <ResultList empty={g.기록물철후보.length ? undefined : "이 업무군의 기록물철 후보를 찾지 못했습니다 — 기안 화면 편철 팝업에서 확인하세요"}>
          {g.기록물철후보.map((f) => (
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
        {map.편철원칙.length ? (
          <>
            <p className={s.src} style={{ marginTop: 12 }}>
              <b>편철 선택 원칙</b> — 출처: {docLink(commonSrc?.문서, commonSrc?.slug)} ·{" "}
              코드표: {docLink(codeSrc?.문서, codeSrc?.slug)}
            </p>
            <ul className={s.notes}>
              {map.편철원칙.map((p, i) => <li key={i} className={s.note}>{p}</li>)}
            </ul>
          </>
        ) : null}
        <ul className={s.notes}>
          {map.규정근거.편철.filter((a) => ["제11조", "제14조"].includes(a.조)).map((a) => (
            <li key={a.조} className={s.note}>
              <b><Link href={`/d/${a.slug}/`}>{a.규정명} {a.조}</Link>({a.제목})</b> — {a.원문.slice(0, 220)}
              {a.원문.length > 220 ? <> … <Link href={`/d/${a.slug}/`}>원문 보기</Link></> : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section icon="④" title="협조냐 결재냐 — 결재선 역할" badge={map.결재선역할.length}
        desc="결재선 설정 팝업에서 고르는 역할입니다. 설명은 전자결재 안내 문서, 근거는 문서관리규정 조문입니다.">
        <ul className={s.roles}>
          {map.결재선역할.map((r) => <RoleCard key={r.역할} role={r} />)}
        </ul>
        {map.일상감사.안내문 ? (
          <div className={s.callout} style={{ marginTop: 12 }}>
            <b>⚠ 일상감사신청</b> — {map.일상감사.안내문}
            {map.일상감사.적용문서.length ? <><br />적용: {map.일상감사.적용문서.join(" · ")}</> : null}
          </div>
        ) : null}
      </Section>

      <Section icon="⑤" title="이 업무의 전결권자" badge={g.전결.length}
        desc="위임전결규정 별표에서 이 업무군 낱말로 찾은 규칙입니다 — 실무 결재선은 부서마다 다를 수 있어요."
        actions={<Link href="/approval/" className={s.src}>결재선 판정기에서 더 보기 →</Link>}>
        <PagedList
          items={rules} unit="건" defaultSize={10} resetKey={`${g.id}|${rank}`}
          note={g.전결매칭어.length ? `일치 낱말: ${g.전결매칭어.join(", ")}` : undefined}
          empty="이 조건에 맞는 전결 규칙이 없어요 — 직급 필터를 풀어보세요."
          filterSlot={ranks.length ? (
            <label className={s.filter}>
              내 직급
              <select className={s.sel} value={rank} onChange={(e) => pickRank(e.target.value)} aria-label="직급 필터">
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

      {map.체크리스트.결재올림전.length ? (
        <Section icon="⑥" title="결재올림 전 최종 확인" badge={map.체크리스트.결재올림전.length}
          desc={`출처: ${commonSrc?.문서 ?? "전자결재 기안 · 결재상신 공통"}`}>
          <ul className={s.chips}>
            {map.체크리스트.결재올림전.map((c, i) => <li key={i} className={s.chip}>✔ {c}</li>)}
          </ul>
        </Section>
      ) : null}

      <p className={s.disclaimer}>
        이 화면은 볼트에 적힌 <b>전자결재 안내 문서·문서관리규정·기록물관리규정·위임전결규정</b>을 모아 보여줄 뿐,
        내용을 새로 만들지 않습니다. <b>첨부서류는 '권장'</b>이고 <b>기록물철은 '후보'</b>입니다 —
        실제 필요 서류·편철·결재선은 업무와 금액, 부서 사정에 따라 다를 수 있으니
        기안 화면과 담당 부서에서 최종 확인하세요.
        {g.결재정보주의.length ? <><br />⚠ {g.이름} 주의: {g.결재정보주의.join(" ")}</> : null}
      </p>
    </>
  );
}
