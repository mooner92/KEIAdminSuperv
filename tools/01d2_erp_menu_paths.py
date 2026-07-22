#!/usr/bin/env python3
"""01d2_erp_menu_paths.py — 현재 볼트의 ERP 시스템 노트에 '메뉴 경로'를 in-place 주입.

배경: RAG가 회수하는 `#### 기능` 청크에 화면코드(gen_0020M)만 있고 사람이 읽을 메뉴 경로가
없어, 답변이 "gen_0020M 화면에서…"처럼 나온다. 경로 데이터는 원본 부록 A 메뉴 트리에 이미 존재
(→ 개요 노트에 통짜로만 들어가 기능 청크와 분리). 이 스크립트는 트리를 파싱해 각 기능의 화면ID
바로 아래에 `- **메뉴 경로**: 복무관리 > 출장관리 > 국내출장신청`을 주입한다.

⛔ 창작 0: 원본 트리에 명시된 경로만. ⛔ 그 외 본문·크로스링크·검수상태 불변(경로 라인만 추가).
멱등: 이미 있으면 건너뜀(01d_system_to_md.inject_menu_paths 재사용). 변환기(01d)도 같은 로직이
들어가 향후 재생성 시 자동 포함 — 결과 동일(드리프트 없음).

실행: cd tools && .venv/bin/python 01d2_erp_menu_paths.py \
        --src /KEIAdminSuperv/KEI_ERP_entire_features.md --vault KEI-행정가이드 [--dry-run]
재색인 필요(경로가 청크에 들어가야 RAG가 봄): 02_chunk_and_embed → API 재시작 → web 재빌드.
"""
import argparse
import importlib.util
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("sysmod", HERE / "01d_system_to_md.py")
_sys = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_sys)

# 대상 = ERP 화면코드를 쓰는 모든 ERP 노트. 부록 A 트리(KEI_ERP_entire_features.md)의 경로를
# 화면ID 기준으로 조인하므로, 어느 변환기(--system erp / --deep-guide)가 만들었든 코드가 맞으면 채움.
#   · 'ERP 시스템 · 모듈'(--system erp) — 메인 화면
#   · 'ERP 상세가이드 · 모듈'(--deep-guide) — 사용자가 실제 인용한 노트. 상세팝업(_NNP)은 트리에 없어 자연 제외
# 제외: NAMS(화면코드 없음·메뉴를 이름으로 서술) · 전자결재 기안(코드가 wait_dochandler.jsp 등, 트리 밖)
def is_target(md: Path) -> bool:
    return md.stem.startswith("ERP 시스템") or md.stem.startswith("ERP 상세가이드")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="ERP 원본(부록 A 메뉴 트리 포함)")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    text = Path(args.src).read_text(encoding="utf-8")
    path_by_code = _sys.parse_menu_tree(text)
    if not path_by_code:
        print("⚠ 부록 A 메뉴 트리를 찾지 못했습니다 — 원본 확인 필요")
        return 1
    print(f"메뉴 경로 맵 {len(path_by_code)}개 로드")

    sysdir = Path(args.vault) / "40_시스템"
    total_notes = total_injected = 0
    for md in sorted(sysdir.rglob("*.md")):
        if not is_target(md):
            continue
        orig = md.read_text(encoding="utf-8")
        new = _sys.inject_menu_paths(orig, path_by_code)
        added = new.count("**메뉴 경로**") - orig.count("**메뉴 경로**")
        if added > 0:
            total_notes += 1
            total_injected += added
            print(f"  + {md.stem}: 경로 {added}개")
            if not args.dry_run:
                md.write_text(new, encoding="utf-8")

    tag = "(dry-run) " if args.dry_run else ""
    print(f"\n{tag}노트 {total_notes}개에 메뉴 경로 {total_injected}개 주입")
    if not args.dry_run and total_injected:
        print("다음: python 02_chunk_and_embed.py --vault", args.vault, "--db tools/chroma")
        print("      → pm2 restart kei-rag-api-dev  → web 재빌드(docdata)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
