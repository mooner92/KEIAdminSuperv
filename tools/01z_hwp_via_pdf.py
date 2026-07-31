#!/usr/bin/env python3
"""01z_hwp_via_pdf.py — HWP 파서가 멈추는 문서를 LibreOffice→PDF로 우회 변환 (docs/64 §11).

배경: `01c_guides_to_md.py`의 HWP 파서(hwp-hwpx-parser)가 일부 문서에서 **무한정 멈춘다.**
      실측 — 여비업무처리기준및QnA(4.2MB): 타임아웃 120초·600초 모두 실패.
      파일 크기가 아니라 문서 구조 문제로 보인다(같은 크기의 다른 HWP는 정상).

우회: HWP → (soffice) → PDF → 01c의 PDF 경로(PyMuPDF)로 태운다.
      별지 파이프라인(01p)이 쓰는 것과 같은 전략이다(docs/50 §8).

⛔ 원본은 수정하지 않는다. 변환 PDF는 임시 디렉터리에 만들고 볼트에는 md만 남는다.
⛔ 스캔 이미지 PDF면 텍스트가 안 나온다 — 그 경우 01c가 image-pdf 플레이스홀더를 남긴다.

  cd tools && .venv/bin/python 01z_hwp_via_pdf.py --src <파일 또는 폴더> --vault <볼트> [--apply]
"""
import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
MIN_CHARS = 200          # 이보다 적으면 스캔 이미지로 의심


def to_pdf(hwp: Path, outdir: Path, timeout: int = 900) -> Path | None:
    """soffice로 PDF 변환. 성공 시 PDF 경로."""
    outdir.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            ["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(outdir), str(hwp)],
            capture_output=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        print(f"  ⛔ soffice 타임아웃: {hwp.name}")
        return None
    pdf = outdir / (hwp.stem + ".pdf")
    return pdf if pdf.exists() and pdf.stat().st_size > 0 else None


def text_len(pdf: Path) -> int:
    """추출 가능한 텍스트 양 — 스캔 이미지 판별용."""
    try:
        import fitz
        d = fitz.open(pdf)
        return sum(len(d[i].get_text()) for i in range(min(5, d.page_count)))
    except Exception:  # noqa: BLE001
        return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="HWP 파일 또는 폴더")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--apply", action="store_true", help="볼트에 실제 적재")
    args = ap.parse_args()

    src = Path(args.src)
    files = [src] if src.is_file() else sorted(
        f for f in src.rglob("*") if f.suffix.lower() in {".hwp", ".hwpx"})
    if not files:
        print("대상 HWP 없음")
        return 1

    stage = Path(tempfile.mkdtemp(prefix="hwp-via-pdf-"))
    pdfdir = stage / "pdf"
    loaddir = stage / "load"
    loaddir.mkdir(parents=True)

    ok, bad = [], []
    for f in files:
        print(f"▶ {f.name}")
        pdf = to_pdf(f, pdfdir)
        if not pdf:
            bad.append((f.name, "PDF 변환 실패"))
            continue
        n = text_len(pdf)
        if n < MIN_CHARS:
            bad.append((f.name, f"텍스트 {n}자 — 스캔 이미지 의심"))
            print(f"  ⚠ 텍스트 {n}자 — 스캔 이미지일 수 있음(적재는 하되 검수 필요)")
        # 볼트 제목이 될 이름으로: 원본 stem 유지
        shutil.copy2(pdf, loaddir / f"{f.stem}.pdf")
        ok.append((f.name, pdf.stat().st_size, n))
        print(f"  ✅ PDF {pdf.stat().st_size//1024}KB · 텍스트 {n}자(앞 5쪽)")

    print(f"\n변환 성공 {len(ok)}개 · 실패 {len(bad)}개")
    for name, why in bad:
        print(f"  ⛔ {name}: {why}")

    if not ok:
        return 1
    if not args.apply:
        print(f"\n(dry-run — 적재하려면 --apply)\n  변환본: {loaddir}")
        return 0

    # 01c의 PDF 경로로 적재
    cmd = [sys.executable, str(HERE / "01c_guides_to_md.py"),
           "--src", str(loaddir), "--vault", args.vault]
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stdout[-1500:] if r.stdout else r.stderr[-800:])
    shutil.rmtree(stage, ignore_errors=True)
    return r.returncode


if __name__ == "__main__":
    sys.exit(main())
