import Link from "next/link";
import SideDrawer from "../common/SideDrawer";
import type { FormEntry } from "../../lib/vault";
import { track } from "../../lib/track";
import s from "./FormPreviewDrawer.module.css";

/** 서식 미리보기 패널(2026-07-25, 사용자 요청) — 서식 찾기에서 **페이지 이동 없이** PDF를 확인한다.
 *
 * 설계 판단(사용자와 합의): 이 화면에 온 사람의 목적은 "이 양식이 맞는지 보고 받아가기"다.
 * 그래서 사이드 패널의 주인공은 **PDF 미리보기**이고, 규정 원문은 패널 안 링크로 함께 둔다
 * (원문이 필요하면 흐름을 깨지 않고 갈 수 있게 — 원문을 주인공으로 두면 대부분 안 본다).
 * PDF가 없는 항목(원본만 있는 양식)은 안내 + 다운로드 버튼만 보여준다.
 */
export default function FormPreviewDrawer({ entry, onClose }: {
  entry: FormEntry | null;
  onClose: () => void;
}) {
  const e = entry;
  const kindLabel = e?.구분 === "연구관리" ? "연구관리양식(PMS)"
    : e?.구분 === "상위법령" ? "상위법령 별표(법제처 원문)" : "규정 별지";
  const pages = typeof e?.쪽수 === "number" && e.쪽수 > 0
    ? (e.꼬리넘침 ? "실질 한 장" : `${e.쪽수}장`) : "";

  return (
    <SideDrawer
      open={!!e}
      onClose={onClose}
      ariaLabel="서식 미리보기"
      title={e?.서식명 || ""}
      subtitle={e ? `${e.규정명}${e.호 ? ` · ${e.호}` : ""}${pages ? ` · ${pages}` : ""} · ${kindLabel}` : ""}
      actions={
        e ? (
          <>
            {e.pdf ? (
              <a className={s.dl} href={e.pdf} download onClick={() => track("forms_download")}>PDF ↓</a>
            ) : null}
            {e.hwp && e.hwp !== e.pdf ? (
              <a className={s.dl} href={e.hwp} download onClick={() => track("forms_download")}>
                {(e.hwp.split(".").pop() || "원본").toUpperCase().replace("%20", "")} ↓
              </a>
            ) : null}
          </>
        ) : null
      }
    >
      {e?.pdf ? (
        <>
          {/* 원문 PDF를 그대로 표시 — 변환·재렌더 없음(⛔절대규칙2: 원문 불변) */}
          <iframe className={s.frame} src={`${e.pdf}#view=FitH`} title={`${e.서식명} 미리보기`} />
          <div className={s.foot}>
            {e.slug ? (
              <Link className={s.origin} href={`/d/${encodeURIComponent(e.slug)}/#${encodeURIComponent(e.anchor)}`}
                onClick={() => track("forms_open")}>
                {e.구분 === "연구관리" ? "안내 화면에서 보기 →" : e.구분 === "상위법령" ? "법령 본문에서 보기 →" : "규정 원문에서 보기 →"}
              </Link>
            ) : <span />}
            <span className={s.hint}>미리보기가 안 보이면 위 [PDF ↓]로 내려받아 확인하세요.</span>
          </div>
        </>
      ) : e ? (
        <div className={s.noPdf}>
          <p><b>미리보기가 없는 서식이에요.</b></p>
          <p className={s.hint}>원본 파일을 내려받아 확인해 주세요{e.hwp ? "(위 다운로드 버튼)" : ""}.</p>
          {e.slug ? (
            <Link className={s.origin} href={`/d/${encodeURIComponent(e.slug)}/#${encodeURIComponent(e.anchor)}`}>
              규정 원문에서 보기 →
            </Link>
          ) : null}
        </div>
      ) : null}
    </SideDrawer>
  );
}
