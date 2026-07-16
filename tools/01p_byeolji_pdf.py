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
import os
import pathlib
import re
import shutil
import subprocess
import sys
import zipfile

import fitz  # PyMuPDF

HERE = pathlib.Path(__file__).resolve().parent
# 페이지 팽창 보정(docs/50 §8) — HWP 전용 서체(한양신명조·함초롬 등)가 서버에 없어
# LO가 Noto CJK(행높이 1.44em)로 폴백 → 줄마다 부풀어 별지 표가 다음 페이지로 밀림.
# ① 한글 서체 → 나눔(1.15em, 설치 폰트 중 최소 메트릭) 결정적 매핑
# ② 비율 줄간격 ×(1/1.15): LO 줄높이 = 배율×폰트메트릭 → HWP 산식(배율×글자크기)으로 환산
# 실측(6540 개인정보보호지침): 44p(Noto) → 35p, 라벨-단독 페이지 6→…(경계 케이스만 잔존).
FONT_FIX = os.environ.get("BYEOLJI_FONT_FIX", "1") != "0"
LH_FACTOR = float(os.environ.get("BYEOLJI_LH_FACTOR", "0.87"))
GOTHIC_PAT = re.compile(r"고딕|돋움|굴림|디나루|시스템|엑스포|헤드라인|안상수|태나무|Gothic|Dotum|Gulim|\bSans\b", re.I)
KOREAN_PAT = re.compile(r"[가-힣]|CJK|Batang|Myeongjo|Myungjo|Dotum|Gulim|Malgun|Gungsuh|Haeso|\bHY", re.I)
KEEP_PAT = re.compile(r"^(NanumMyeongjo|NanumGothic)$")
LABEL = re.compile(r"[\[〔［(]?\s*별\s*지\s*(제?\s*\d+(?:-\d+)?\s*호(?:의\s*\d+)?)?\s*(?:서\s*식)?\s*[\]〕］)]?")
# 줄 시작이 괄호+별지 라벨(호 생략·'10-A' 영문 가지번호 허용) — 개정이력 꼬리가 붙은 실서식 라벨용
LABEL_ANCHOR = re.compile(
    r"^[\[〔［(<【]\s*별\s*지\s*제?\s*(\d+(?:-[0-9A-Za-z]+)?)\s*(호(?:\s*의\s*\d+)?)?\s*(?:서\s*식)?\s*[\]〕］)>】]?")
# 별표 라벨 — 범위 경계 전용(별표는 md 본문·VLM 트랙 소관, 다운로드 항목 아님).
# 없으면 마지막 별지 범위가 뒤따르는 별표를 삼킴(실측: 6540 위임장 [31,35]가 별표1호 포함)
BYEOLPYO_ANCHOR = re.compile(
    r"^[\[〔［(<【]\s*별\s*표\s*제?\s*(\d+(?:-\d+)?)?\s*호?\s*[\]〕］)>】]?")
# 페이지 상단(첫 6줄)에서만 별지 라벨을 인정 — 본문 중 '별지 제1호 서식에 따라' 인용 오탐 방지
TOP_LINES = 6


def frontmatter_source(md: pathlib.Path) -> str:
    for line in md.read_text(encoding="utf-8").splitlines()[:20]:
        m = re.match(r'원본파일:\s*"?([^"\n]+)"?\s*$', line.strip())
        if m:
            return m.group(1).strip()
    return ""


def _map_family(name: str) -> str:
    """한글/CJK 서체명 → 설치된 나눔으로. 라틴(DejaVu·Liberation…)은 그대로."""
    bare = name.replace("&apos;", "").strip().strip("'")
    if KEEP_PAT.match(bare) or not KOREAN_PAT.search(bare):
        return name
    return "NanumGothic" if GOTHIC_PAT.search(bare) else "NanumMyeongjo"


def _rewrite_odt(odt: pathlib.Path) -> None:
    """content/styles.xml의 ①서체 선언 치환 ②비율 줄간격 보정 — in-place 재압축.
    ⚠ fontconfig 매핑은 LO가 무시함(실측: strong binding에도 Noto SC 폴백) → ODT 직접 치환."""
    def fix_xml(xml: str) -> str:
        def repl(m):
            mapped = _map_family(m.group(1))
            return m.group(0) if mapped == m.group(1) else f'svg:font-family="{mapped}"'
        xml = re.sub(r'svg:font-family="([^"]+)"', repl, xml)
        xml = re.sub(r'fo:line-height="(\d+)%"',
                     lambda m: f'fo:line-height="{max(80, round(int(m.group(1)) * LH_FACTOR))}%"', xml)
        return xml

    tmp = odt.with_suffix(".odt.tmp")
    with zipfile.ZipFile(odt) as zin, zipfile.ZipFile(tmp, "w") as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename in ("content.xml", "styles.xml"):
                data = fix_xml(data.decode("utf-8")).encode("utf-8")
            zout.writestr(item, data, compress_type=item.compress_type)
    tmp.replace(odt)


def _soffice(args: list, outdir: pathlib.Path, src: pathlib.Path, conv: str) -> pathlib.Path:
    profile = HERE / ".byeolji_cache" / "lo-profile"
    cmd = ["soffice", "--headless", "--norestore",
           f"-env:UserInstallation=file://{profile}",
           "--convert-to", conv, "--outdir", str(outdir), str(src)] + args
    subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    return outdir / (src.stem + "." + conv.split(":")[0])


def convert_pdf(hwp: pathlib.Path, out_pdf: pathlib.Path, force: bool) -> tuple:
    """(성공, 캐시히트) — 캐시히트면 재변환 안 함(재색인 훅의 증분 동작 근거).
    기본 경로: HWP→ODT→(서체·줄간격 보정)→PDF. ODT 단계 실패 시 직행 PDF 폴백."""
    if out_pdf.exists() and not force and out_pdf.stat().st_mtime >= hwp.stat().st_mtime:
        return True, True
    out_pdf.parent.mkdir(parents=True, exist_ok=True)
    if FONT_FIX:
        try:
            odt = _soffice([], out_pdf.parent, hwp, "odt")
            if odt.exists():
                _rewrite_odt(odt)
                produced = _soffice([], out_pdf.parent, odt, "pdf:writer_pdf_Export")
                odt.unlink(missing_ok=True)
                if produced.exists():
                    if produced != out_pdf:
                        shutil.move(str(produced), str(out_pdf))
                    return True, False
        except Exception as e:  # noqa: BLE001
            print(f"  ⚠ 보정 변환 실패({hwp.name}): {e} → 직행 PDF 폴백")
    produced = _soffice([], out_pdf.parent, hwp, "pdf:writer_pdf_Export")
    if produced.exists():
        if produced != out_pdf:
            shutil.move(str(produced), str(out_pdf))
        return True, False
    print(f"  ⚠ 변환 실패: {hwp.name}")
    return False, False


def norm_label(raw: str) -> str:
    """'별지 제 1 호', '별지 1', '제10-A호' 등 → '별지 제1호' / 번호 없으면 '별지'"""
    m = re.search(r"(\d+(?:-[0-9A-Za-z]+)?)\s*호?(의\s*\d+)?", raw or "")
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


def _strip_history(rest: str) -> str:
    """라벨 뒤 개정 이력 꼬리 제거 — '삭제 <2010…>', '<신설 …>', '[신설 2020.…]<개정 …>' 등."""
    rest = re.sub(r"^(삭\s*제)\s*", "", rest)
    rest = re.sub(r"[<〈].*$", "", rest)
    rest = re.sub(r"[\[［]\s*(신\s*설|개\s*정|전문개정|일부개정)[^\]］]*[\]］]?\s*", "", rest)
    return rest.strip()


def find_byeolji_pages(doc) -> list:
    """[(page_idx, label, name_guess)].
    PDF 텍스트는 라벨을 여러 줄로 쪼갠다('[' / '별지제1' / '호서식]') — 상단 줄을
    압축 결합해 매칭한다. 본문 인용 오탐 방지: 압축 문자열 앞 80자 내 라벨만 인정."""
    hits = []
    for i, page in enumerate(doc):
        lines = [l.strip() for l in page.get_text().splitlines() if l.strip()]
        label = None
        # ① 줄 단위 우선: 줄 시작이 라벨이고, 라벨·개정이력(<신설/개정 …>·삭제) 제거 후
        #   잔여가 거의 없으면 실라벨. '[별지 제5호 서식] <신설 2010., …>'처럼 이력 꼬리가
        #   긴 줄도 잡고, '[별지 제N호 서식]에 따라 …' 본문 인용(잔여 있음)은 거른다.
        #   한 페이지에 라벨 여러 개(삭제 스텁 목록 + 실서식) 가능 — 전부 수집하되
        #   삭제 스텁은 stub=True(범위 경계로만 쓰고 다운로드 항목에선 제외).
        #   첫 매치는 상단 TOP_LINES 안이어야 하고, 이후엔 연속 라벨 줄만 이어 붙인다.
        page_hits = []
        in_run = False
        for li, l in enumerate(lines):
            m2 = LABEL_ANCHOR.match(l)
            mp = BYEOLPYO_ANCHOR.match(l) if not m2 else None
            if not m2 and not mp:
                if in_run:
                    break
                if li >= TOP_LINES:
                    break
                continue
            if not in_run and li >= TOP_LINES:
                break
            mm = m2 or mp
            raw_rest = l[mm.end():].strip()
            rest = _strip_history(raw_rest)
            if len(rest.replace(" ", "")) > 8:
                if in_run:
                    break
                continue
            if mp:  # 별표 = 경계 전용(항목 미생성)
                page_hits.append((f"별표 {mp.group(1) or ''}".strip(), True))
            else:
                page_hits.append((norm_label(m2.group(0)), bool(re.match(r"삭\s*제", raw_rest))))
            in_run = True
        if page_hits:
            name = _page_title(page, skip_texts=set())
            for lab, stub in page_hits:
                hits.append((i, lab, name, stub))
            continue
        if label is None:
            # ② 폴백: 상단 '짧은 줄' 연속 결합(라벨이 '['/'별지제1'/'호서식]'처럼 여러 줄로
            #   쪼개진 경우). 긴 줄(본문 문단)이 나오면 중단 — 인용 오탐 차단.
            short = []
            for l in lines[:TOP_LINES]:
                c = l.replace(" ", "")
                if len(c) > 28:
                    break
                short.append(c)
            compact = "".join(short)
            # 러닝헤드(----규정명) 제거 후 위치 판단
            compact_wo = re.sub(r"^[-–—=]+[가-힣]{0,12}", "", compact)
            m = re.search(r"[\[〔［(<]별지제?(\d+(?:-[0-9A-Za-z]+)?)호?(의\d+)?", compact_wo)
            g = re.search(r"[\[〔［(<]별지", compact_wo)
            pos = m.start() if m else (g.start() if g else -1)
            if pos < 0 or pos > 80:
                continue
            label = f"별지 제{m.group(1)}호{(m.group(2) or '').replace(' ', '')}" if m else "별지"
        name = _page_title(page, skip_texts=set())
        hits.append((i, label, name, False))
    # ③ 심층 패스: 페이지 상단에서 못 찾은 라벨을 전체 줄에서 수색 — 별지가 새 페이지로
    #   시작하지 않는 규정(라벨이 페이지 중·하단, 실측 9건: 내부감사·연구윤리·기록물관리 등).
    #   괄호로 시작하는 단독 라벨 줄만 인정(잔여≤8 가드 동일). 인용은 조문(문서 앞),
    #   서식은 문서 끝에 몰리므로 라벨별 '마지막 출현'을 취한다.
    found = {h[1] for h in hits}
    deep = {}
    for i, page in enumerate(doc):
        lines = [l.strip() for l in page.get_text().splitlines() if l.strip()]
        for li, l in enumerate(lines):
            m2 = LABEL_ANCHOR.match(l)
            if not m2:
                continue
            raw_rest = l[m2.end():].strip()
            if len(_strip_history(raw_rest).replace(" ", "")) > 8:
                continue
            lab = norm_label(m2.group(0))
            if lab in found or re.match(r"삭\s*제", raw_rest):
                continue
            # 라벨이 페이지 하단이면 서식 본문(제목)은 다음 페이지에 있다
            tp = i + 1 if (li >= len(lines) - 6 and i + 1 < len(doc)) else i
            deep[lab] = (i, lab, _page_title(doc[tp], skip_texts=set()), False)
    hits.extend(deep.values())
    hits.sort(key=lambda h: h[0])
    return hits


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="/KEIAdminSuperv/rule_files,"
                    + str(pathlib.Path(os.path.expanduser(
                        os.environ.get("KEI_UPLOAD_DIR", "~/kei-uploads"))) / "originals"),
                    help="HWP 원본 디렉터리(콤마 구분 다중 — 업로드 편입 규정 지원, docs/50 §6)")
    ap.add_argument("--vault", default=str(HERE.parent / "KEI-행정가이드"))
    ap.add_argument("--out", default=str(HERE.parent / "web" / "public" / "forms-pdf"))
    ap.add_argument("--png", default=str(HERE / "byeolji_png"))
    ap.add_argument("--manifest", default=str(HERE / "index" / "byeolji_manifest.json"))
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    src_dirs = [pathlib.Path(d.strip()) for d in args.src.split(",") if d.strip()]
    vault = pathlib.Path(args.vault) / "20_규정원문"
    cache = HERE / ".byeolji_cache" / "pdf"
    manifest = {}
    mpath0 = pathlib.Path(args.manifest)
    prev = {}
    if mpath0.exists() and not args.force:
        try:
            prev = json.loads(mpath0.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            prev = {}
    stats = {"regs": 0, "converted": 0, "byeolji": 0, "reused": 0, "no_src": [], "convert_fail": []}

    mds = sorted(vault.rglob("*.md"))
    for md in mds:
        if md.name == "README.md" or md.name == "목차.md":
            continue
        stem = md.stem
        if args.only and args.only not in stem:
            continue
        srcname = frontmatter_source(md)
        hwp = None
        if srcname:
            for d in src_dirs:
                if (d / srcname).exists():
                    hwp = d / srcname
                    break
        if hwp is None:
            stats["no_src"].append(stem)
            continue
        stats["regs"] += 1
        pdf = cache / f"{stem}.pdf"
        ok_c, cached = convert_pdf(hwp, pdf, args.force)
        if not ok_c:
            stats["convert_fail"].append(stem)
            continue
        stats["converted"] += 1
        # 증분 재사용(docs/50 §6): PDF 캐시히트 + 이전 manifest 항목 + 산출물 실존 → 분리·렌더 스킵
        pmt = round(pdf.stat().st_mtime, 2)
        pe = prev.get(stem)
        if cached and pe and pe.get("pdf_mtime") == pmt:
            outs_ok = all((HERE / png).exists() for b in pe.get("별지", []) for png in b.get("pngs", []))
            outs_ok = outs_ok and all(
                (pathlib.Path(args.out).parent / b["pdf"]).exists() for b in pe.get("별지", []))
            if outs_ok:
                manifest[stem] = pe
                stats["byeolji"] += len(pe.get("별지", []))
                stats["reused"] += 1
                continue
        doc = fitz.open(pdf)
        hits = find_byeolji_pages(doc)
        entries = []
        reg_name = stem.split("_", 1)[-1]
        for n, (pidx, label, name, stub) in enumerate(hits):
            # 삭제 스텁은 범위 경계로만 쓰고 다운로드 항목 생성은 건너뜀(폐지 서식 미제공)
            if stub:
                continue
            end = (hits[n + 1][0] - 1) if n + 1 < len(hits) else len(doc) - 1
            end = max(end, pidx)  # 같은 페이지에 다음 라벨이 있으면 1페이지 범위
            def _fn(t, limit):
                return re.sub(r"[\\/:*?\"<>|\s]+", "", t)[:limit]
            safe = _fn(reg_name, 30) + "_" + _fn(label, 12) + (("_" + _fn(name, 30)) if name else "")
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
            # 원본 HWP 사본 — 사람이 실제 편집·작성할 수 있게(별지만 HWP 분리는 포맷상 불가 →
            # 규정 원문 전체 한글파일 제공, docs/50 §7)
            hwp_rel = None
            try:
                out_pdf_dir = pathlib.Path(args.out) / stem
                out_pdf_dir.mkdir(parents=True, exist_ok=True)
                hwp_dst = out_pdf_dir / hwp.name
                if not hwp_dst.exists() or hwp_dst.stat().st_mtime < hwp.stat().st_mtime:
                    shutil.copy2(hwp, hwp_dst)
                hwp_rel = f"forms-pdf/{stem}/{hwp.name}"
            except Exception as e_h:  # noqa: BLE001
                print(f"  ⚠ 원본 HWP 복사 실패: {e_h}")
            manifest[stem] = {"규정명": stem.split("_", 1)[-1], "원본": srcname, "hwp": hwp_rel,
                              "총페이지": len(doc), "pdf_mtime": pmt, "별지": entries}
        doc.close()
        print(f"  {stem}: 별지 {len(entries)}건")

    mpath = pathlib.Path(args.manifest)
    mpath.parent.mkdir(parents=True, exist_ok=True)
    mpath.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n규정 {stats['regs']}건 · 변환 {stats['converted']}건(재사용 {stats['reused']}) · 별지 {stats['byeolji']}건 → {mpath}")
    if stats["no_src"]:
        print(f"⚠ 원본 매핑 실패 {len(stats['no_src'])}건: {', '.join(stats['no_src'][:8])}…")
    if stats["convert_fail"]:
        print(f"⚠ 변환 실패 {len(stats['convert_fail'])}건: {', '.join(stats['convert_fail'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
