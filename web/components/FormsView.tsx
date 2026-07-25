// 서식 찾기 본문(호롱 — 규정 찾기의 '서식' 탭). pages/forms.tsx에서 추출, 동작 불변.
import { useEffect, useMemo, useState } from "react";
import BrowseShell from "./common/BrowseShell";
import PagedList from "./common/PagedList";
import SearchInput from "./common/SearchInput";
import { FilterGroup, FilterCheck, FilterSearch, FilterEmpty } from "./common/BrowseFilter";
import ResultRow, { ResultList, RowTag, RowAction, RowBadge } from "./common/ResultRow";
import FormPreviewDrawer from "./forms/FormPreviewDrawer";
import { useFlag } from "../lib/flags";
import { track } from "../lib/track";
import type { FormEntry } from "../lib/vault"; // ⚠ loadForms(fs)는 페이지 getStaticProps에서만 — 클라 번들 안전
import f from "../styles/Forms.module.css";

// 서식 찾기(docs/34 ①, flag forms_registry) — 규정 별지 서식 대장.
// 수작업 0: 규정 원문의 [별지 제N호 서식] 라벨을 빌드타임 추출(loadForms). 폐지(삭제) 서식 제외.
// "별지 3"·"출장"·규정명 어느 쪽으로도 찾게 통합 검색 1칸.

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, "");
}

export default function FormsView({ forms }: { forms: FormEntry[] }) {
  const on = useFlag("forms_registry");
  const [q, setQ] = useState("");
  const [regFilter, setRegFilter] = useState<Set<string>>(new Set()); // 규정명 필터(체크박스)
  const [regQ, setRegQ] = useState(""); // 필터 패널 내 규정 검색
  const [preview, setPreview] = useState<FormEntry | null>(null); // 우측 미리보기 패널(페이지 이동 없이 PDF 확인)
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
  const toggleReg = (r: string) =>
    setRegFilter((prev) => { const n = new Set(prev); n.has(r) ? n.delete(r) : n.add(r); return n; });

  if (!on) {
    return <p style={{ color: "var(--color-text-tertiary)", padding: "40px 0", textAlign: "center" }}>이 기능은 아직 준비 중이에요. 곧 만나요!</p>;
  }

  return (
    <>
      <p className={f.tabLead}>
        규정 별지 서식 {forms.filter((e) => !e.구분 || e.구분 === "별지").length}종 +
        연구관리양식(PMS) {forms.filter((e) => e.구분 === "연구관리").length}종 +
        상위법령 별표 {forms.filter((e) => e.구분 === "상위법령").length}종(법제처 원문) —
        이름·규정명·번호로 검색하고 바로 열어보세요.
      </p>
      <BrowseShell
        sideTitle="필터"
        reset={{ count: regFilter.size, onClick: () => setRegFilter(new Set()) }}
        side={
          <FilterGroup title="규정" scroll>
            <FilterSearch value={regQ} onChange={setRegQ}
              placeholder="규정 이름으로 좁히기" ariaLabel="규정 필터 검색" />
            {regShown.map(([r, n]) => (
              <FilterCheck key={r} label={r} count={n} checked={regFilter.has(r)} onChange={() => toggleReg(r)} />
            ))}
            {regShown.length === 0 ? <FilterEmpty>해당 규정이 없어요.</FilterEmpty> : null}
          </FilterGroup>
        }
        head={
          <SearchInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onClear={() => setQ("")}
            placeholder="서식 이름·규정명·번호로 검색 — 예: 출장, 연구사업이행각서, 별지 3"
            ariaLabel="서식 검색"
          />
        }
      >
        <PagedList
          items={shown}
          unit="건"
          defaultSize={30}
          resetKey={`${q}|${[...regFilter].sort().join(",")}`}
          empty="검색 결과가 없어요 — 다른 이름이나 규정명으로 찾아보세요."
        >
          {(paged) => (
            <ResultList>
              {paged.map((e) => (
                <ResultRow
                  key={`${e.slug}#${e.호}`}
                  lead={e.호 || "—"}
                  title={
                    <button type="button" className={f.titleBtn} onClick={() => setPreview(e)}
                      title="미리보기 — 오른쪽에서 서식을 바로 확인">{e.서식명}</button>
                  }
                  chips={
                    <>
                      <RowTag>{e.규정명}</RowTag>
                      {typeof e.쪽수 === "number" && e.쪽수 > 0 ? (
                        <RowBadge ok={e.쪽수 === 1 || !!e.꼬리넘침}>
                          {e.꼬리넘침 ? "≈1장" : `${e.쪽수}장`}
                        </RowBadge>
                      ) : null}
                    </>
                  }
                  right={
                    <>
                      {e.pdf ? (
                        <RowAction onClick={() => setPreview(e)} title="오른쪽 패널에서 미리보기">👁 미리보기</RowAction>
                      ) : null}
                      {e.pdf ? (
                        <RowAction href={e.pdf} download
                          title={e.구분 === "연구관리" ? "PDF 미리보기 — 어떻게 생긴 양식인지 바로 확인" : "이 별지만 담긴 원문 PDF"}>PDF ↓</RowAction>
                      ) : null}
                      {e.hwp && e.hwp !== e.pdf ? (
                        <RowAction href={e.hwp} download
                          title={e.구분 === "연구관리" ? "원본 파일 — 실제 작성·제출용" : "규정 원문 전체 한글파일 — 서식 편집·작성용"}>
                          {(e.hwp.split(".").pop() || "원본").toUpperCase().replace("%20", "")} ↓
                        </RowAction>
                      ) : null}
                      {e.slug ? (
                        <RowAction href={`/d/${encodeURIComponent(e.slug)}/#${encodeURIComponent(e.anchor)}`}
                          onClick={() => track("forms_open")} title="원문 문서에서 이 서식 위치로 이동">
                          {e.구분 === "연구관리" ? "안내 →" : e.구분 === "상위법령" ? "법령 →" : "원문 →"}
                        </RowAction>
                      ) : null}
                    </>
                  }
                />
              ))}
            </ResultList>
          )}
        </PagedList>
      </BrowseShell>
      <FormPreviewDrawer entry={preview} onClose={() => setPreview(null)} />
    </>
  );
}

