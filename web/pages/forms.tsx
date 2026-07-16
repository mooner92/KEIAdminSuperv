import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { GetStaticProps } from "next";
import Layout from "../components/Layout";
import { useFlag } from "../lib/flags";
import { SITE_NAME } from "../lib/site";
import { track } from "../lib/track";
import { loadForms, type FormEntry } from "../lib/vault";
import styles from "../styles/Home.module.css";
import f from "../styles/Forms.module.css";

// 서식 찾기(docs/34 ①, flag forms_registry) — 규정 별지 서식 대장.
// 수작업 0: 규정 원문의 [별지 제N호 서식] 라벨을 빌드타임 추출(loadForms). 폐지(삭제) 서식 제외.
// "별지 3"·"출장"·규정명 어느 쪽으로도 찾게 통합 검색 1칸.

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, "");
}

export default function FormsPage({ forms }: { forms: FormEntry[] }) {
  const on = useFlag("forms_registry");
  const [q, setQ] = useState("");
  const [regFilter, setRegFilter] = useState<Set<string>>(new Set()); // 규정명 필터(체크박스)
  const [regQ, setRegQ] = useState(""); // 필터 패널 내 규정 검색
  const [pageSize, setPageSize] = useState(30); // 10/30/50개씩 보기(docs/50)
  const [page, setPage] = useState(1);
  // 사용량(docs/35): 검색은 1.2s 디바운스 1건 — 검색어 자체는 보내지 않음
  useEffect(() => {
    if (!q.trim()) return;
    const t = setTimeout(() => track("forms_search"), 1200);
    return () => clearTimeout(t);
  }, [q]);

  // 검색어(텍스트+번호)만 적용한 결과 — 규정 패싯 카운트 산출용
  const searched = useMemo(() => {
    const t = norm(q);
    if (!t) return forms;
    // 번호 질의("별지 3"·"6-1호") — 잔여 텍스트가 있으면 텍스트 조건과 AND 결합
    // (리뷰 확정: '내부감사규정 별지 3'이 전 규정 3호로 넓어지던 문제)
    const numM = q.match(/(?:별지\s*)?제?\s*(\d+(?:-\d+)?)\s*호|별지\s*(\d+(?:-\d+)?)/);
    const numToken = numM ? (numM[1] || numM[2]) : "";
    const rest = norm(q.replace(/별지|서식|제?\s*\d+(?:-\d+)?\s*호?/g, ""));
    return forms.filter((e) => {
      const textHit = rest
        ? norm(e.서식명).includes(rest) || norm(e.규정명).includes(rest)
        : norm(e.서식명).includes(t) || norm(e.규정명).includes(t);
      const numHit = numToken ? e.호.includes(`제${numToken}호`) : true;
      if (numToken && rest) return textHit && numHit;      // "내부감사규정 별지 3" → AND
      if (numToken && /별지|호|서식/.test(q)) return numHit; // "별지 3" 단독 → 번호만
      return textHit;
    });
  }, [q, forms]);

  // 규정 목록(서식 수 내림차순) — 검색 결과 기준 패싯 카운트
  const regList = useMemo(() => {
    const cnt = new Map<string, number>();
    for (const e of searched) cnt.set(e.규정명, (cnt.get(e.규정명) || 0) + 1);
    return [...cnt.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [searched]);
  const regShown = regQ.trim() ? regList.filter(([r]) => norm(r).includes(norm(regQ))) : regList;

  // 최종 목록 = 검색 + 규정 필터
  const shown = useMemo(
    () => (regFilter.size ? searched.filter((e) => regFilter.has(e.규정명)) : searched),
    [searched, regFilter]
  );
  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize));
  const cur = Math.min(page, pageCount);
  const paged = shown.slice((cur - 1) * pageSize, cur * pageSize);
  const toggleReg = (r: string) =>
    setRegFilter((prev) => { const n = new Set(prev); n.has(r) ? n.delete(r) : n.add(r); return n; });
  useEffect(() => { setPage(1); }, [q, regFilter, pageSize]); // 조건 변경 → 1페이지

  if (!on) {
    return (
      <Layout>
        <Head><title>{`서식 찾기 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
        <section className={styles.heroCompact}>
          <h1 className={styles.h1}>서식 찾기</h1>
          <p className={styles.lead}>이 기능은 아직 준비 중이에요. 곧 만나요!</p>
        </section>
      </Layout>
    );
  }

  return (
    <Layout>
      <Head><title>{`서식 찾기 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
      <section className={styles.heroCompact}>
        <h1 className={styles.h1}>서식 찾기</h1>
        <p className={styles.lead}>
          규정에 딸린 별지 서식 {forms.length}종을 한곳에서 찾아요 — 서식 이름·규정명·번호로 검색하고,
          원문에서 바로 확인하세요.
        </p>
      </section>

      <div className={f.layout}>
        {/* 좌측 규정 필터(규정 둘러보기와 동일 패턴) */}
        <aside className={f.filters} aria-label="규정 필터">
          <div className={f.filterHead}>
            <span className={f.filterTitle}>규정</span>
            {regFilter.size > 0 ? (
              <button className={f.reset} onClick={() => setRegFilter(new Set())}>초기화 {regFilter.size}</button>
            ) : null}
          </div>
          <input className={f.regSearch} value={regQ} onChange={(e) => setRegQ(e.target.value)}
            placeholder="규정 이름으로 좁히기" aria-label="규정 필터 검색" />
          <div className={f.regList}>
            {regShown.map(([r, n]) => {
              const checked = regFilter.has(r);
              return (
                <label key={r} className={`${f.regItem} ${!checked && n === 0 ? f.regMuted : ""}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggleReg(r)} />
                  <span className={f.regName}>{r}</span>
                  <span className={f.regCount}>{n}</span>
                </label>
              );
            })}
            {regShown.length === 0 ? <p className={f.regEmpty}>해당 규정이 없어요.</p> : null}
          </div>
        </aside>

        {/* 우측 검색 + 결과 */}
        <div className={f.main}>
          <input
            className={f.search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="서식 이름·규정명·번호로 검색 — 예: 출장, 연구사업이행각서, 별지 3"
            aria-label="서식 검색"
            autoFocus
          />
          <div className={f.metaRow}>
            <p className={f.count}>
              {shown.length}건 · {shown.length === 0 ? 0 : (cur - 1) * pageSize + 1}–{Math.min(cur * pageSize, shown.length)}
              {q ? ` · "${q}"` : ""}{regFilter.size ? ` · 규정 ${regFilter.size}개 필터` : ""}
            </p>
            <div className={f.pager}>
              <span className={f.pageSizeGrp}>
                {[10, 30, 50].map((n) => (
                  <button key={n} className={`${f.psBtn} ${pageSize === n ? f.psActive : ""}`}
                    onClick={() => setPageSize(n)}>{n}</button>
                ))}
                <span className={f.psUnit}>개씩</span>
              </span>
              <span className={f.pageNav}>
                <button className={f.navBtn} disabled={cur <= 1} onClick={() => setPage(cur - 1)} aria-label="이전 페이지">‹</button>
                <span className={f.pageInfo}>{cur} / {pageCount}</span>
                <button className={f.navBtn} disabled={cur >= pageCount} onClick={() => setPage(cur + 1)} aria-label="다음 페이지">›</button>
              </span>
            </div>
          </div>

          <div className={f.tableWrap}>
            <table className={f.table}>
              <thead><tr><th>서식명</th><th>규정</th><th>번호</th><th>원문 서식</th><th></th></tr></thead>
              <tbody>
                {paged.map((e) => (
                  <tr key={`${e.slug}#${e.호}`}>
                    <td className={f.name}>{e.서식명}</td>
                    <td>{e.규정명}</td>
                    <td className={f.no}>{e.호}</td>
                    <td>
                      {e.pdf ? (
                        <a className={f.dl} href={e.pdf} download onClick={() => track("forms_search")}>
                          PDF ↓
                        </a>
                      ) : (
                        <span className={f.dlNone}>—</span>
                      )}
                    </td>
                    <td>
                      <Link className={f.go} href={`/d/${encodeURIComponent(e.slug)}/#${encodeURIComponent(e.anchor)}`}
                        onClick={() => track("forms_open")}>
                        원문 보기 →
                      </Link>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 ? (
                  <tr><td colSpan={4} className={f.empty}>검색 결과가 없어요 — 다른 이름이나 규정명으로 찾아보세요.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className={f.note}>
            ※ 폐지(삭제)된 서식은 목록에 나오지 않아요. 실제 제출은 전자결재(ERP·그룹웨어) 양식이 우선일 수
            있으니 담당 부서 안내를 함께 확인하세요.
          </p>
        </div>
      </div>
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = () => ({ props: { forms: loadForms() } });
