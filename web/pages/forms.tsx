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
  // 사용량(docs/35): 검색은 1.2s 디바운스 1건 — 검색어 자체는 보내지 않음
  useEffect(() => {
    if (!q.trim()) return;
    const t = setTimeout(() => track("forms_search"), 1200);
    return () => clearTimeout(t);
  }, [q]);
  const shown = useMemo(() => {
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

      <input
        className={f.search}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="서식 이름·규정명·번호로 검색 — 예: 출장, 연구사업이행각서, 별지 3"
        aria-label="서식 검색"
        autoFocus
      />
      <p className={f.count}>{shown.length}건{q ? ` · "${q}"` : ""}</p>

      <div className={f.tableWrap}>
        <table className={f.table}>
          <thead><tr><th>서식명</th><th>규정</th><th>번호</th><th></th></tr></thead>
          <tbody>
            {shown.map((e) => (
              <tr key={`${e.slug}#${e.호}`}>
                <td className={f.name}>{e.서식명}</td>
                <td>{e.규정명}</td>
                <td className={f.no}>{e.호}</td>
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
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = () => ({ props: { forms: loadForms() } });
