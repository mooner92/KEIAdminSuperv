#!/usr/bin/env python3
"""01p — 규정 HWP 원본 → PDF → 별지(서식) 페이지 분리·렌더 (docs/50).

산출물(전부 git-external — 내부 규정 콘텐츠):
  1) tools/.byeolji_cache/pdf/<md-stem>.pdf         : 규정 전체 PDF(변환 캐시)
  2) web/public/forms-pdf/<md-stem>/<별지>.pdf      : 별지별 분리 PDF(다운로드용, 로그인 게이트 뒤 서빙)
  3) tools/byeolji_png/<md-stem>/<별지>_pN.png      : 별지 페이지 렌더(깨진 MD 복원·검수용)
  4) tools/index/byeolji_manifest.json              : 규정↔별지↔파일 매핑(서식찾기 다운로드 조인)

변환기: LibreOffice(soffice) + H2Orestart 확장(deploy/setup_ubuntu_hwp.sh).
매핑: 볼트 20_규정원문/*.md 프론트매터 `원본파일` ↔ rule_files/ 파일명(정확 일치).

실행: .venv/bin/python tools/01p_byeolji_pdf.py \
        --src /KEIAdminSuperv/rule_files --vault KEI-행정가이드 [--only <stem substr>] [--force]
"""
import argparse
import json
import pathlib
import re
import shutil
import subprocess
import sys

import fitz  # PyMuPDF

HERE = pathlib.Path(__file__).resolve().parent
LABEL = re.compile(r"[\[〔［(]?\s*별\s*지\s*(제?\s*\d+(?:-\d+)?\s*호(?:의\s*\d+)?)?\s*(?:서\s*식)?\s*[\]〕］)]?")
# 페이지 상단(첫 6줄)에서만 별지 라벨을 인정 — 본문 중 '별지 제1호 서식에 따라' 인용 오탐 방지
TOP_LINES = 6


def frontmatter_source(md: pathlib.Path) -> str:
    for line in md.read_text(encoding="utf-8").splitlines()[:20]:
        m = re.match(r'원본파일:\s*"?([^"\n]+)"?\s*$', line.strip())
        if m:
            return m.group(1).strip()
    return ""


def convert_pdf(hwp: pathlib.Path, out_pdf: pathlib.Path, force: bool) -> bool:
    if out_pdf.exists() and not force and out_pdf.stat().st_mtime >= hwp.stat().st_mtime:
        return True
    out_pdf.parent.mkdir(parents=True, exist_ok=True)
    profile = HERE / ".byeolji_cache" / "lo-profile"
    cmd = [
        "soffice", "--headless", "--norestore",
        f"-env:UserInstallation=file://{profile}",
        "--convert-to", "pdf:writer_pdf_Export",
        "--outdir", str(out_pdf.parent), str(hwp),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    produced = out_pdf.parent / (hwp.stem + ".pdf")
    if produced.exists():
        if produced != out_pdf:
            shutil.move(str(produced), str(out_pdf))
        return True
    print(f"  ⚠ 변환 실패: {hwp.name} — {r.stderr.strip()[:120]}")
    return False


def norm_label(raw: str) -> str:
    """'별지 제 1 호', '별지 1' 등 → '별지 제1호' / 번호 없으면 '별지'"""
    m = re.search(r"(\d+(?:-\d+)?)\s*호?(의\s*\d+)?", raw or "")
    if not m:
        return "별지"
    tail = (m.group(2) or "").replace(" ", "")
    return f"별지 제{m.group(1)}호{tail}"


def _page_title(page, skip_texts) -> str:
    """서식명 추정 = 페이지에서 폰트가 가장 큰 텍스트 스팬(라벨·러닝헤드 제외)."""
    best, best_size = "", 0.0
    d = page.get_text("dict")
    for blk in d.get("blocks", []):
        for ln in blk.get("lines", []):
            text = "".join(sp.get("text", "") for sp in ln.get("spans", [])).strip()
            comp = text.replace(" ", "")
            if not text or len(comp) < 2:
                continue
            if "별지" in comp or "서식]" in comp or re.match(r"^[-–—=]{3,}", text):
                continue
            if comp in skip_texts:
                continue
            size = max((sp.get("size", 0) for sp in ln.get("spans", [])), default=0)
            if size > best_size:
                best, best_size = text[:60], size
    return best


def find_byeolji_pages(doc) -> list:
    """[(page_idx, label, name_guess)].
    PDF 텍스트는 라벨을 여러 줄로 쪼갠다('[' / '별지제1' / '호서식]') — 상단 줄을
    압축 결합해 매칭한다. 본문 인용 오탐 방지: 압축 문자열 앞 80자 내 라벨만 인정."""
    hits = []
    for i, page in enumerate(doc):
        lines = [l.strip() for l in page.get_text().splitlines() if l.strip()]
        compact = "".join(lines[:TOP_LINES]).replace(" ", "")
        # 러닝헤드(----규정명) 제거 후 위치 판단
        compact_wo = re.sub(r"^[-–—=]+[가-힣]{0,12}", "", compact)
        m = re.search(r"[\[〔［(]?별지제?(\d+(?:-\d+)?)호(의\d+)?", compact_wo)
        g = re.search(r"[\[〔［(]별지", compact_wo)
        pos = m.start() if m else (g.start() if g else -1)
        if pos < 0 or pos > 80:
            continue
        label = f"별지 제{m.group(1)}호{(m.group(2) or '').replace(' ', '')}" if m else "별지"
        name = _page_title(page, skip_texts=set())
        hits.append((i, label, name))
    return hits


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="/KEIAdminSuperv/rule_files")
    ap.add_argument("--vault", default=str(HERE.parent / "KEI-행정가이드"))
    ap.add_argument("--out", default=str(HERE.parent / "web" / "public" / "forms-pdf"))
    ap.add_argument("--png", default=str(HERE / "byeolji_png"))
    ap.add_argument("--manifest", default=str(HERE / "index" / "byeolji_manifest.json"))
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    src = pathlib.Path(args.src)
    vault = pathlib.Path(args.vault) / "20_규정원문"
    cache = HERE / ".byeolji_cache" / "pdf"
    manifest = {}
    stats = {"regs": 0, "converted": 0, "byeolji": 0, "no_src": [], "convert_fail": []}

    mds = sorted(vault.rglob("*.md"))
    for md in mds:
        if md.name == "README.md" or md.parent.name == "0000_미분류":
            continue
        stem = md.stem
        if args.only and args.only not in stem:
            continue
        srcname = frontmatter_source(md)
        hwp = src / srcname if srcname else None
        if not srcname or not hwp.exists():
            stats["no_src"].append(stem)
            continue
        stats["regs"] += 1
        pdf = cache / f"{stem}.pdf"
        if not convert_pdf(hwp, pdf, args.force):
            stats["convert_fail"].append(stem)
            continue
        stats["converted"] += 1
        doc = fitz.open(pdf)
        hits = find_byeolji_pages(doc)
        entries = []
        for n, (pidx, label, name) in enumerate(hits):
            end = (hits[n + 1][0] - 1) if n + 1 < len(hits) else len(doc) - 1
            safe = re.sub(r"[^\w가-힣-]", "", label)
            # ① 분리 PDF(다운로드)
            out_pdf_dir = pathlib.Path(args.out) / stem
            out_pdf_dir.mkdir(parents=True, exist_ok=True)
            part = fitz.open()
            part.insert_pdf(doc, from_page=pidx, to_page=end)
            part_path = out_pdf_dir / f"{safe}.pdf"
            part.save(part_path)
            part.close()
            # ② 렌더 PNG(복원·검수)
            png_dir = pathlib.Path(args.png) / stem
            png_dir.mkdir(parents=True, exist_ok=True)
            pngs = []
            for p in range(pidx, end + 1):
                pix = doc[p].get_pixmap(dpi=120)
                pp = png_dir / f"{safe}_p{p - pidx + 1}.png"
                pix.save(pp)
                pngs.append(str(pp.relative_to(HERE)))
            entries.append({
                "label": label, "name": name,
                "pages": [pidx + 1, end + 1],
                "pdf": f"forms-pdf/{stem}/{safe}.pdf",
                "pngs": pngs,
            })
            stats["byeolji"] += 1
        if entries:
            manifest[stem] = {"규정명": stem.split("_", 1)[-1], "원본": srcname,
                              "총페이지": len(doc), "별지": entries}
        doc.close()
        print(f"  {stem}: 별지 {len(entries)}건")

    mpath = pathlib.Path(args.manifest)
    mpath.parent.mkdir(parents=True, exist_ok=True)
    mpath.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n규정 {stats['regs']}건 · 변환 {stats['converted']}건 · 별지 {stats['byeolji']}건 → {mpath}")
    if stats["no_src"]:
        print(f"⚠ 원본 매핑 실패 {len(stats['no_src'])}건: {', '.join(stats['no_src'][:8])}…")
    if stats["convert_fail"]:
        print(f"⚠ 변환 실패 {len(stats['convert_fail'])}건: {', '.join(stats['convert_fail'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
