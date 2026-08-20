import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Section from "../common/Section";
import TaskPicker from "./TaskPicker";
import SummaryCards, { type SummaryCard } from "./SummaryCards";
import DocTypeSection from "./DocTypeSection";
import AttachSection from "./AttachSection";
import FileSection from "./FileSection";
import RoleSection from "./RoleSection";
import ApprovalSection from "./ApprovalSection";
import SourceNote from "./SourceNote";
import type { GianMap } from "../../lib/gian";
import s from "./Gian.module.css";

// 기안 도우미(docs/72 P4) — "누가 결재하나"(/approval) **다음** 질문에 답하는 화면.
// 업무를 고르면 ⓐ어떤 문서로 ⓑ무엇을 첨부(권장) ⓒ기록물철 후보 ⓓ결재선 역할 ⓔ전결권자.
//
// 이 파일은 **오케스트레이터**다 — 상태(업무군·직급)와 섹션 배치만 갖고, 각 섹션의 렌더는
// components/gian/*Section.tsx가 스스로 한다(운영자 지적 "컴포넌트화가 안 됐다", 2026-08-20).
//
// 화면 규약(같은 지적의 나머지 절반 "정보 나열이라 어딜 볼지 모르겠다"):
//   1. 업무 선택 → 요약 카드 4개(문서·첨부·편철·전결) → 섹션 상세 순으로 **위계**를 준다.
//   2. 각 섹션의 첫 화면엔 한눈에 읽히는 요약만 두고, 조문 원문·체크리스트 전문·편철 원칙은
//      `<details>`(components/gian/Fold)로 내린다. ⛔삭제가 아니라 접기다(절대 규칙 4).
//   3. ①~⑥ 번호는 버렸다 — 번호는 모든 섹션에 같은 무게를 줘서 위계를 지운다.
//
// ⛔ 절대 규칙
//  1. 화면의 모든 항목은 볼트 문서에서 왔고, 줄마다 출처(문서명·조·원문행)를 함께 보여준다.
//  2. 첨부는 규정이 아니라 시스템 노트의 '첨부 권장' 서술 → `권장` 라벨 + 단정 금지.
//  3. 근거를 못 찾은 자리는 비우고 "원문 확인"을 안내한다(추정 금지).

const PICK_KEY = "kei-gian-group";   // 마지막 업무 선택(여비 계산기 kei-travel-ho와 같은 관례)
const ROLE_KEY = "kei-approval-role"; // 직급 기억은 결재선 판정기와 **같은 키**를 공유한다

const ID = { doc: "gian-doc", attach: "gian-attach", file: "gian-file", role: "gian-role", rule: "gian-rule", note: "gian-note" };

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

  const cards: SummaryCard[] = g ? [
    { id: ID.doc, icon: "📄", label: "문서종류", value: g.문서종류.length, unit: "종" },
    { id: ID.attach, icon: "📎", label: "첨부", value: g.첨부권장.length, unit: "건", note: "권장" },
    { id: ID.file, icon: "🗂", label: "기록물철", value: g.기록물철후보.length, unit: "철", note: "후보" },
    { id: ID.rule, icon: "⚖", label: "전결 규칙", value: g.전결.length, unit: "건" },
  ] : [];

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

  return (
    <>
      <Section icon="🧾" title="어떤 업무의 기안인가요?"
        desc="업무를 고르면 문서종류·첨부(권장)·기록물철·결재선 역할·전결권자를 한 화면에 모아 보여드려요.">
        <TaskPicker groups={map.업무군} current={g} onPick={pick} src={applySrc} />
        <SummaryCards cards={cards} />
      </Section>

      <DocTypeSection id={ID.doc} group={g} articles={map.규정근거.기안문} forms={map.서식} />
      <AttachSection id={ID.attach} group={g} checklist={map.체크리스트.첨부확인} src={commonSrc} />
      <FileSection id={ID.file} group={g} principles={map.편철원칙} articles={map.규정근거.편철}
        commonSrc={commonSrc} codeSrc={codeSrc} />
      <RoleSection id={ID.role} roles={map.결재선역할} audit={map.일상감사} />
      <ApprovalSection id={ID.rule} group={g} rules={rules} ranks={ranks} rank={rank} onRank={pickRank} />
      <SourceNote id={ID.note} group={g} checklist={map.체크리스트.결재올림전} sources={map.sources} />
    </>
  );
}
