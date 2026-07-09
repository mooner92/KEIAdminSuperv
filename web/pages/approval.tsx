import { useEffect, useState } from "react";
import AsyncState from "../components/AsyncState";
import Head from "next/head";
import { SITE_NAME } from "../lib/site";
import Link from "next/link";
import Layout from "../components/Layout";
import ApprovalExplorer from "../components/ApprovalExplorer";
import { type ApprovalRule } from "../components/ApprovalFinder";
import { useFlag } from "../lib/flags";
import styles from "../styles/Home.module.css";

/**
 * 결재선 판정기 — 독립 페이지(상단 메뉴). 규정 둘러보기와 동일한 UX:
 * 좌측 체크박스 필터(직급·구분·전결권자) + 검색 범위 태그 + 페이지네이션.
 * 데이터 = 위임전결규정 별표(01n) → out/approval.json lazy fetch.
 * ⛔ 공식 전결기준(별표 원문) 표시 전용 — 실무 결재선(중간 검토자 등)은 부서 확인 안내 필수.
 */
export default function ApprovalPage() {
  const on = useFlag("approval_finder");
  const [rules, setRules] = useState<ApprovalRule[] | null>(null);
  const [err, setErr] = useState("");
  const load = () => {
    setErr("");
    fetch("/approval.json")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => setRules(d.rules || []))
      .catch(() => setErr("전결규칙 데이터를 불러오지 못했습니다."));
  };
  useEffect(load, []);
  return (
    <Layout fill>
      <Head>
        <title>{`결재선 판정기 · ${SITE_NAME}`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <section className={styles.heroCompact}>
        <h1 className={styles.h1}>결재선 판정기</h1>
        <p className={styles.lead}>
          왼쪽에서 직급·구분·전결권자로 좁히고, 업무를 검색하면 <b>전결권자</b>(최종 결재)를{" "}
          <Link href="/d/2300_위임전결규정/">위임전결규정</Link> 별표 그대로 알려드려요. ⚠ 실제
          결재선(중간 검토자 등)은 부서마다 다를 수 있어요 — 반드시 부서에서 확인하세요.
        </p>
      </section>
      {!on ? (
        <p className={styles.lead}>이 기능은 아직 준비 중이에요. (관리자가 켜면 사용할 수 있습니다)</p>
      ) : err || rules === null ? (
        <AsyncState loading={!err} error={err} onRetry={load} />
      ) : (
        <ApprovalExplorer rules={rules} />
      )}
    </Layout>
  );
}
