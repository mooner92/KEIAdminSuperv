#!/usr/bin/env python3
"""01h_law_fetch.py — law.go.kr(법제처) Open API 수집 → 25_상위법령/법령/ (docs/61 U2-ⓐ).

allowlist(tools/law_allowlist.json)의 법령·행정규칙만 수집한다 — ⛔ 전체 미러링 금지.
법령명은 **정확 일치**(공백·가운뎃점 정규화)만 채택: 유사명 오적재 방지(예: '정부출연연구기관
…법률'과 '과학기술분야 정부출연연구기관…법률'은 다른 법 — KEI는 전자).

- 인증: env `LAW_OC`(법제처 Open API 인증키). 필수.
- 증분: tools/index/law_fetch_state.json 에 시행/공포일자 저장 — 같으면 skip(--force로 강제).
  cron에 걸어도 무변경 시 수 초 종료(docs/61 §3).
- 본문: 조문 단위 XML → 평문 마크다운(조문내용이 '제N조(제목) …'로 시작 — 볼트 경계 규약과
  일치, 어댑터 불필요). ⛔ 원문 무가공(절대규칙 2). 담당자명·전화번호 등 개인정보 필드는
  본문에 쓰지 않는다(조문만). 별표 HWP 첨부는 v1 미수집(프론트매터 비고).
- 약관 준수: 출처(법제처) 명기 + 원문 무변경(신청 약관 — docs/61 §6).

실행: LAW_OC=<키> python tools/01h_law_fetch.py [--only "근로기준법"] [--force] [--dry]
이후: python tools/02_chunk_and_embed.py --vault KEI-행정가이드 --db tools/chroma --layer uplaw
"""
import argparse
import datetime
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VAULT = ROOT.parent / "KEI-행정가이드"
OUT_DIR = VAULT / "25_상위법령" / "법령"
STATE_F = ROOT / "index" / "law_fetch_state.json"
BASE = "http://www.law.go.kr/DRF"
OC = os.environ.get("LAW_OC", "")


def _norm_name(s: str) -> str:
    """법령명 비교 정규화 — 공백 제거 + 가운뎃점(ㆍ·) 통일."""
    return re.sub(r"\s+", "", s or "").replace("·", "ㆍ")


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "KEI-admin-guide/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def _api(path: str, **params) -> ET.Element:
    params = {"OC": OC, "type": "XML", **params}
    url = f"{BASE}/{path}?" + urllib.parse.urlencode(params)
    root = ET.fromstring(_get(url))
    return root


def search_exact(query: str, target: str):
    """목록 검색 → 법령명 정확 일치 + 현행만. 실패 시 None(⛔ 유사명 추측 금지)."""
    root = _api("lawSearch.do", target=target, query=query, display=30)
    want = _norm_name(query)
    if target == "law":
        for e in root.iter("law"):
            name = e.findtext("법령명한글", "")
            if _norm_name(name) != want or e.findtext("현행연혁코드") != "현행":
                continue
            return {"id": e.findtext("법령ID", "").strip(), "이름": name.strip(),
                    "공포일자": e.findtext("공포일자", ""), "시행일자": e.findtext("시행일자", ""),
                    "소관": e.findtext("소관부처명", ""), "종류": e.findtext("법령구분명", "법령"),
                    "링크": "https://www.law.go.kr" + (e.findtext("법령상세링크", "") or "")}
    else:  # admrul
        for e in root.iter("admrul"):
            name = e.findtext("행정규칙명", "")
            if _norm_name(name) != want or e.findtext("현행연혁구분") != "현행":
                continue
            return {"id": e.findtext("행정규칙ID", "").strip(), "이름": name.strip(),
                    # ⚠ admrul 본문 상세(별표단위 포함)는 lawService.do가 '행정규칙일련번호'를 요구
                    #   한다(행정규칙ID로는 별표단위 0건 — 2026-07-24 실측, docs/61 v3). 별표 수집용.
                    "일련번호": e.findtext("행정규칙일련번호", "").strip(),
                    "공포일자": e.findtext("발령일자", ""), "시행일자": e.findtext("시행일자", ""),
                    "소관": e.findtext("소관부처명", ""),
                    "종류": e.findtext("행정규칙종류", "행정규칙"),
                    "링크": "https://www.law.go.kr" + (e.findtext("행정규칙상세링크", "") or "")}
    return None


def _unit_text(unit: ET.Element) -> str:
    """조문단위(법령) — 조문내용+항/호/목 내용을 문서 순서로 합침(원문 무가공)."""
    lines = []
    for e in unit.iter():
        if e.tag.endswith("내용") and e.text and e.text.strip():
            lines.append(e.text.rstrip())
    return "\n".join(lines).strip()


def fetch_body(target: str, law_id: str) -> str:
    if target == "law":
        root = _api("lawService.do", target="law", ID=law_id)
        parts = [_unit_text(u) for u in root.iter("조문단위")]
        # 부칙(있으면 뒤에 — 시행일 근거)
        for u in root.iter("부칙단위"):
            t = _unit_text(u)
            if t:
                parts.append(t)
        return "\n\n".join(p for p in parts if p)
    # admrul: 조문내용이 루트 직속 flat 목록 + 부칙
    root = _api("lawService.do", target="admrul", LID=law_id)
    parts = [e.text.strip() for e in root.iter("조문내용") if e.text and e.text.strip()]
    for u in root.iter("부칙"):
        t = _unit_text(u)
        if t:
            parts.append(t)
    return "\n\n".join(parts)


def _fmt_date(d: str) -> str:
    d = (d or "").strip()
    return f"{d[:4]}-{d[4:6]}-{d[6:8]}" if re.match(r"^\d{8}$", d) else d


ANNEX_DIR = ROOT.parent / "web" / "public" / "forms-pdf" / "uplaw"


def fetch_annexes(items, only: str = "", force: bool = False) -> int:
    """--annex: allowlist 법령·행정규칙의 별표·서식 PDF 수집(docs/61 v2/v3) → web/public/forms-pdf/uplaw/.

    본문 XML의 <별표단위>가 제목+PDF 다운로드 링크(별표서식PDF파일링크)를 제공(법제처 원문 PDF —
    변환 불필요, 원문 무변경·출처 명기 약관 준수). manifest.json은 서식 찾기(loadForms)가 소비.
    ⚠ admrul(고시)도 lawService.do 본문에 <별표단위>를 제공함이 실측 확정(2026-07-24, docs/61 v3 —
    연구개발비 사용 기준 30건 등). v2의 'admrul 미제공' 판단은 오류였고 target만 분기하면 동일 경로다.
    server.js가 forms-pdf를 직서빙(재빌드 불필요)."""
    ANNEX_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []
    n_dl = n_skip = 0
    for it in items:
        if only and only not in it["query"]:
            continue
        hit = search_exact(it["query"], it["target"])
        if not hit:
            print(f"✗ {it['query']}: 검색 실패"); continue
        # admrul 별표단위는 행정규칙일련번호로만 조회됨(위 search_exact 주석) — law는 법령ID 그대로.
        body_id = hit.get("일련번호") if it["target"] == "admrul" and hit.get("일련번호") else hit["id"]
        root = _api("lawService.do", target=it["target"], ID=body_id)
        law_dir = ANNEX_DIR / hit["이름"]
        for u in root.iter("별표단위"):
            gu = (u.findtext("별표구분") or "별표").strip()
            no = int(u.findtext("별표번호") or "0")
            gaji = int(u.findtext("별표가지번호") or "0")
            # API 제목이 이중 이스케이프(&lt;개정...&gt;)로 오는 경우 해제(실측: 혁신법 별표3)
            title = html.unescape(html.unescape((u.findtext("별표제목") or "").strip()))
            link = (u.findtext("별표서식PDF파일링크") or "").strip()
            if not link:
                continue
            if title.startswith("삭제"):
                continue  # 폐지(삭제) 별표 제외 — 서식 찾기 원칙(기존 별지와 동일)과 정합
            # 별표번호 0 = 무번호 단일 별표(원문 표기 [별표]) — '별표 0' 오표기 방지
            if gu != "별표":
                label = f"{gu} 제{no}호" if no else gu
            else:
                label = f"별표 {no}" if no else "별표"
            if gaji:
                label += f"의{gaji}"
            safe = re.sub(r'[\\/:*?"<>|]+', " ", title)[:60].strip()
            fname = f"{label}_{safe}.pdf"
            dst = law_dir / fname
            if dst.exists() and not force:
                n_skip += 1
            else:
                law_dir.mkdir(parents=True, exist_ok=True)
                try:
                    dst.write_bytes(_get("https://www.law.go.kr" + link))
                    n_dl += 1
                except Exception as e:  # noqa: BLE001
                    print(f"  ✗ {hit['이름']} {label}: 다운로드 실패 {e}")
                    continue
            pages = None
            try:  # 쪽수(서식 찾기 N.p 배지) — PyMuPDF 실측
                import fitz
                pages = len(fitz.open(dst))
            except Exception:  # noqa: BLE001 — 쪽수 실패는 배지만 생략
                pass
            manifest.append({"법령명": hit["이름"], "라벨": label, "제목": title,
                             "pdf": f"{hit['이름']}/{fname}", "구분": gu, "쪽수": pages,
                             "출처": "법제처 국가법령정보센터"})
        print(f"· {hit['이름']}: 별표·서식 {sum(1 for m in manifest if m['법령명']==hit['이름'])}건")
    (ANNEX_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n별표·서식 PDF 다운로드 {n_dl} · 기존 skip {n_skip} · manifest {len(manifest)}건")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--allowlist", default=str(ROOT / "law_allowlist.json"))
    ap.add_argument("--only", help="이 이름 하나만(부분 일치)")
    ap.add_argument("--force", action="store_true", help="무변경이어도 재수집")
    ap.add_argument("--dry", action="store_true", help="수집·비교만, 기록 안 함")
    ap.add_argument("--annex", action="store_true",
                    help="본문 대신 별표·서식 PDF 수집(web/public/forms-pdf/uplaw + manifest)")
    args = ap.parse_args()
    if not OC:
        raise SystemExit("⛔ env LAW_OC 필요(법제처 Open API 인증키)")

    items = json.loads(Path(args.allowlist).read_text(encoding="utf-8"))["items"]
    if args.annex:
        return fetch_annexes(items, only=args.only or "", force=args.force)
    if args.only:
        items = [x for x in items if args.only in x["query"]]
    state = json.loads(STATE_F.read_text(encoding="utf-8")) if STATE_F.exists() else {}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    today = datetime.date.today().isoformat()
    n_new = n_skip = n_fail = 0

    for it in items:
        q, target, strength = it["query"], it["target"], it.get("강도", "직접")
        try:
            hit = search_exact(q, target)
        except Exception as e:  # noqa: BLE001
            print(f"✗ {q}: 검색 실패 {type(e).__name__}: {e}"); n_fail += 1; continue
        if not hit:
            print(f"✗ {q}: 정확 일치·현행 없음(⛔ 유사명 추측 안 함)"); n_fail += 1; continue
        prev = state.get(hit["이름"], {})
        if (not args.force and prev.get("시행일자") == hit["시행일자"]
                and prev.get("공포일자") == hit["공포일자"]):
            print(f"= {hit['이름']}: 무변경(시행 { _fmt_date(hit['시행일자'])}) — skip")
            n_skip += 1
            continue
        try:
            body = fetch_body(target, hit["id"])
        except Exception as e:  # noqa: BLE001
            print(f"✗ {q}: 본문 실패 {type(e).__name__}: {e}"); n_fail += 1; continue
        if len(body) < 200:
            print(f"✗ {q}: 본문이 비정상적으로 짧음({len(body)}자) — 기록 안 함"); n_fail += 1; continue
        arts = len(re.findall(r"^\s*제\s*\d+\s*조", body, re.MULTILINE))
        if args.dry:
            print(f"○ {hit['이름']}: {len(body)}자 · 조문줄 {arts} (dry)")
            continue
        fm = (
            "---\n"
            "type: uplaw\n"
            f"법령명: \"{hit['이름']}\"\n"
            f"개정일: {_fmt_date(hit['시행일자']) or _fmt_date(hit['공포일자'])}\n"
            f"소관: \"{hit['소관']}\"\n"
            f"적용강도: {strength}\n"
            f"출처URL: \"{hit['링크']}\"\n"
            f"원본파일: \"법제처 국가법령정보센터 Open API ({hit['종류']}, ID={hit['id']})\"\n"
            "변환기: \"01h_law_fetch\"\n"
            f"적재일: {today}\n"
            "비고: \"조문·부칙만(별표 첨부파일 미수집 v1) · 출처: 법제처 · 원문 무변경\"\n"
            "검수상태: 미검수\n"
            "---\n\n"
            f"# {hit['이름']}\n\n"
            f"(공포 {_fmt_date(hit['공포일자'])} · 시행 {_fmt_date(hit['시행일자'])} · 소관 {hit['소관']}"
            f" · 출처: 법제처 국가법령정보센터)\n\n"
        )
        (OUT_DIR / f"{hit['이름']}.md").write_text(fm + body + "\n", encoding="utf-8")
        state[hit["이름"]] = {"시행일자": hit["시행일자"], "공포일자": hit["공포일자"],
                             "fetched": today, "target": target}
        print(f"✓ {hit['이름']}: {len(body)}자 · 조문줄 {arts} · 강도 {strength}")
        n_new += 1

    if not args.dry:
        STATE_F.parent.mkdir(exist_ok=True)
        STATE_F.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n수집 {n_new} · 무변경 skip {n_skip} · 실패 {n_fail}"
          + ("" if n_fail == 0 else " ⚠ 실패 항목은 allowlist 이름 확인"))
    return 1 if n_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
