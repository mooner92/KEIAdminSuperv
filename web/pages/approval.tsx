import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import Layout from "../components/Layout";
import ApprovalFinder, { type ApprovalRule } from "../components/ApprovalFinder";
import { useFlag } from "../lib/flags";
import styles from "../styles/Approval.module.css";

/**
 * 결재선 판정기 — 독립 페이지(상단 메뉴). 위임전결규정 별표(01n)의 전결규칙을
 * 업무 검색 + 신청자 직급으로 조회한다. 데이터는 빌드타임 out/approval.json을 lazy fetch.
 * ⛔ 공식 전결기준(별표 원문) 표시 전용 — 실무 결재선(중간 검토자 등)은 부서 확인 안내 필수.
 */
export default function ApprovalPage() {
  const on = useFlag("approval_finder");
  const [rules, setRules] = useState<ApprovalRule[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch("/approval.json")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => setRules(d.rules || []))
      .catch(() => setErr("전결규칙 데이터를 불러오지 못했습니다."));
  }, []);
  return (
    <Layout
      breadcrumb={
        <span>
          <Link href="/">전직원 연구행정 가이드</Link>
          <span className={styles.sep}>›</span>결재선 판정기
        </span>
      }
    >
      <Head>
        <title>결재선 판정기 · KEI 행정 가이드</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className={styles.head}>
        <h1 className={styles.h1}>결재선 판정기</h1>
        <p className={styles.lead}>
          업무와 신청자 직급을 고르면 <b>전결권자</b>(최종 결재)를{" "}
          <Link href="/d/2300_위임전결규정/">위임전결규정</Link> 별표 그대로 알려드려요.
        </p>
        <p className={styles.caveat}>
          ⚠ 공식 전결기준(별표 원문)입니다. 실제 결재선(중간 검토자 등)은 부서마다 다를 수 있어요 — 반드시 부서에서 확인하세요.
        </p>
      </div>
      {!on ? (
        <p className={styles.state}>이 기능은 아직 준비 중이에요. (관리자가 켜면 사용할 수 있습니다)</p>
      ) : err ? (
        <p className={styles.state}>{err}</p>
      ) : rules === null ? (
        <p className={styles.state}>불러오는 중…</p>
      ) : (
        <ApprovalFinder rules={rules} />
      )}
    </Layout>
  );
}
