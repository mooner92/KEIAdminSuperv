import { useCallback, useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import Layout from "../components/Layout";
import {
  AdminDashboard, AdminCorpus, AdminTableRestore, AdminTrust,
  AdminReports, AdminUsage, AdminUsers, AdminFlags, AdminFaqBridge,
} from "../components/admin";
import { api, ApiError } from "../lib/api";
import { SITE_NAME } from "../lib/site";
import { useFlag } from "../lib/flags";
import styles from "../styles/Admin.module.css";

// 관리자 페이지(v1.1 UX 개편, docs/21) — **탭 셸만** 담당한다. 각 탭 내용은 components/admin/의
// 독립 컴포넌트가 자체 데이터·상태를 소유(docs/53 UI 관례). 탭 상태는 URL 해시(#corpus 등)와
// 동기화(새로고침·딥링크 유지). 접근은 백엔드 403이 방어(여기선 flagsManage로 게이트 확인).
type Tab = "dash" | "corpus" | "restore" | "faq" | "trust" | "reports" | "usage" | "users" | "flags";
const TAB_KEYS: Tab[] = ["dash", "corpus", "restore", "faq", "trust", "reports", "usage", "users", "flags"];
const TABS: { k: Tab; label: string }[] = [
  { k: "dash", label: "📊 대시보드" },
  { k: "corpus", label: "📚 코퍼스 관리" },
  { k: "restore", label: "🔧 표 복원" },
  { k: "faq", label: "🌉 FAQ 브리지" },
  { k: "trust", label: "🛡 신뢰" },
  { k: "reports", label: "📮 의견함" },
  { k: "usage", label: "📈 통계" },
  { k: "users", label: "👥 사용자" },
  { k: "flags", label: "🚩 기능 플래그" },
];

export default function AdminPage() {
  const corpusOn = useFlag("corpus_admin");
  const restoreOn = useFlag("table_restore");
  const faqOn = useFlag("faq_bridge");
  const usersOn = useFlag("user_directory");
  const trustOn = useFlag("trust_ops");
  const reportsOn = useFlag("feedback_center"); // docs/51: 📮 의견함
  const [tab, setTab] = useState<Tab>("dash");
  const [gate, setGate] = useState<"loading" | "ok" | string>("loading");

  // 해시 ↔ 탭 동기화(딥링크·새로고침 유지)
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace("#", "") as Tab;
      if (TAB_KEYS.includes(h)) setTab(h);
    };
    // 모바일(≤640px)·해시 없음 → 관리자 주 화면인 의견함(AI 자동수정)으로 진입(docs/54).
    if (!window.location.hash && window.matchMedia("(max-width: 640px)").matches) {
      setTab("reports");
    }
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const go = (t: Tab) => { setTab(t); window.history.replaceState(null, "", `#${t}`); };

  // 관리자 게이트만 확인 — 데이터 로딩은 각 탭 컴포넌트가 스스로 한다.
  const checkGate = useCallback(() => {
    api.flagsManage()
      .then(() => setGate("ok"))
      .catch((e) => {
        setGate(e instanceof ApiError
          ? (e.status === 403 ? "관리자 전용 페이지입니다. (APP_ADMINS에 등록된 계정으로 로그인 필요)"
            : e.status === 401 ? "로그인이 필요합니다." : e.message)
          : "불러오기에 실패했습니다.");
      });
  }, []);
  useEffect(checkGate, [checkGate]);

  // 플래그로 잠긴 탭은 표시하지 않는다(백엔드가 최종 방어). dash·usage·flags는 항상 노출.
  const gated: Partial<Record<Tab, boolean>> = {
    corpus: corpusOn, restore: restoreOn, faq: faqOn, trust: trustOn, reports: reportsOn, users: usersOn,
  };
  const visibleTabs = TABS.filter((t) => gated[t.k] !== false);

  return (
    <Layout breadcrumb={<span><Link href="/">{SITE_NAME}</Link><span className={styles.sep}>›</span>관리자</span>}>
      <Head>
        <title>{`관리자 · ${SITE_NAME}`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <h1 className={styles.h1}>관리자</h1>
      {gate !== "ok" ? (
        <div className={styles.err}>{gate === "loading" ? "확인 중…" : gate}</div>
      ) : (
        <>
          <nav className={styles.tabBar} role="tablist" aria-label="관리자 메뉴">
            {visibleTabs.map((t) => (
              <button key={t.k} role="tab" aria-selected={tab === t.k}
                className={`${styles.tabBtn} ${tab === t.k ? styles.tabOn : ""}`}
                onClick={() => go(t.k)}>
                {t.label}
              </button>
            ))}
          </nav>

          {tab === "dash" ? <AdminDashboard /> : null}
          {tab === "corpus" && corpusOn ? <AdminCorpus /> : null}
          {tab === "restore" && restoreOn ? <AdminTableRestore /> : null}
          {tab === "faq" && faqOn ? <AdminFaqBridge /> : null}
          {tab === "trust" && trustOn ? <AdminTrust /> : null}
          {tab === "reports" && reportsOn ? <AdminReports /> : null}
          {tab === "usage" ? <AdminUsage /> : null}
          {tab === "users" && usersOn ? <AdminUsers /> : null}
          {tab === "flags" ? <AdminFlags /> : null}
        </>
      )}
    </Layout>
  );
}
