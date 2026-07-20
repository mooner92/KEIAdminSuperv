import { useEffect, useState } from "react";
import { api, type MaintDiffRow } from "../../lib/api";
import PagedList from "../common/PagedList";
import Section from "../common/Section";
import styles from "../../styles/Admin.module.css";
import f from "../../styles/Feedback.module.css";

// 🚧 오토픽스 관문 실패 diff 열람(docs/52 실전 검증 반영) — gate_web 등에서 폐기된 시도의
// claude 변경을 관리자가 /admin에서 직접 본다. '코드 탓 vs 환경 탓' 진단용. 실패가 없으면 섹션 자체 숨김.
const fmtAt = (epoch: number) =>
  new Date(epoch * 1000).toLocaleString("ko-KR", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

// diff 한 줄을 성격별로 색칠(+추가/−삭제/@위치/파일머리) — 스키밍 가독성.
function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ")) return f.dfMeta;
  if (line.startsWith("@@")) return f.dfHunk;
  if (line.startsWith("+")) return f.dfAdd;
  if (line.startsWith("-")) return f.dfDel;
  return "";
}

export default function AdminMaintDiffs() {
  const [rows, setRows] = useState<MaintDiffRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ afId: string; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.maintDiffs().then((r) => setRows(r.diffs)).catch(() => setRows([])); }, []);

  const toggle = async (afId: string) => {
    if (open === afId) { setOpen(null); return; }
    setOpen(afId); setDiff(null); setLoading(true);
    try {
      const r = await api.maintDiff(afId);
      setDiff({ afId, text: r.diff });
    } catch {
      setDiff({ afId, text: "(diff를 불러오지 못했습니다)" });
    } finally { setLoading(false); }
  };

  if (rows === null || rows.length === 0) return null; // 실패 diff 없으면 섹션 미표시(노이즈 방지)

  return (
    <Section icon="🚧" title="오토픽스 관문 실패 diff"
      desc="관문(금지구역·구문·웹 빌드)에 막혀 폐기된 자동수정 시도의 변경 내용이에요. 실패가 코드 탓인지 환경 탓인지 여기서 확인하세요 — 이 변경은 어디에도 반영되지 않았습니다.">
      <PagedList items={rows} sizes={[5, 15, 30]} unit="건" note="최신순">
        {(paged) => (
          <div className={f.noticeList}>
            {(paged as MaintDiffRow[]).map((d) => (
              <div key={d.af_id} className={f.diffRow}>
                <button className={f.diffHead} onClick={() => toggle(d.af_id)}
                  aria-expanded={open === d.af_id}>
                  <span className={f.diffHeadMain}>
                    {open === d.af_id ? "▾" : "▸"} {d.report_id ? `#${d.report_id}` : "—"}
                    <span className={f.diffGate}>{d.gate}</span>
                    <span className={f.diffWhy}>{d.why}</span>
                  </span>
                  <span className={f.diffMeta}>
                    {d.files.length}파일 · {fmtAt(d.at)}
                  </span>
                </button>
                {open === d.af_id ? (
                  loading ? <p className={styles.muted}>diff 불러오는 중…</p> : (
                    <pre className={f.diffBox}>
                      {(diff?.text || "").split("\n").map((ln, i) => (
                        <span key={i} className={diffLineClass(ln)}>{ln + "\n"}</span>
                      ))}
                    </pre>
                  )
                ) : null}
              </div>
            ))}
          </div>
        )}
      </PagedList>
    </Section>
  );
}
