#!/usr/bin/env python3
"""journeys_lint.py — 업무 여정(_journeys/*.json)의 결정적 무결성 검사 (docs/25).

여정 데이터는 사람이(또는 에이전트 초안으로) 큐레이션하므로, 볼트와의 정합을 기계로 강제한다:
  ① 스키마·구조: 필수 필드, lanes/stages 참조 유효, edges가 실존 노드 연결
  ② 근거 해석 가능: 각 근거의 '규정명'이 볼트 문서 제목(프론트매터 규정명/제목)과 정확히 일치
  ③ 조 존재: '제N조'/'별표 N'은 해당 문서 본문에 실존, 그 외 문자열은 본문 포함 여부
  ④ ERP 코드: erp.코드가 40_시스템 노트에 실존
  ⑤ 수치 금지: action에 화폐 금액(원) 기입 금지(근거 링크로 대체 — 값은 원문·수치 스토어의 몫)

실행: .venv/bin/python tools/journeys_lint.py --vault KEI-행정가이드 [--file <단일.json>]
종료코드: 0=전부 통과, 1=위반 존재(위반 목록 출력)
"""
import argparse
import json
import re
import sys
from pathlib import Path

MONEY_RE = re.compile(r"\d[\d,]*\s*(?:만원|천원|억원|원(?!문))")  # '별표 1 원문' 오탐 방지


def split_fm(text: str):
    if text.startswith("---"):
        try:
            _, fm, body = text.split("---", 2)
        except ValueError:
            return {}, text
        meta = {}
        for ln in fm.strip().splitlines():
            if ":" in ln:
                k, v = ln.split(":", 1)
                meta[k.strip()] = v.strip().strip('"').strip("'")
        return meta, body
    return {}, text


def build_title_index(vault: Path):
    idx = {}
    for md in vault.rglob("*.md"):
        try:
            meta, body = split_fm(md.read_text(encoding="utf-8", errors="ignore"))
        except Exception:
            continue
        if not meta.get("type"):
            continue
        title = (meta.get("규정명") or meta.get("제목") or meta.get("용어") or md.stem).strip()
        idx.setdefault(title, []).append(body)
    return idx


def check_basis(b: dict, titles: dict, errs: list, where: str):
    name, jo = (b.get("규정명") or "").strip(), (b.get("조") or "").strip()
    if name not in titles:
        errs.append(f"{where}: 규정명 '{name}' — 볼트 문서 제목과 불일치(드로어 연결 불가)")
        return
    if not jo:
        return
    bodies = "\n".join(titles[name])
    if re.match(r"^제\d+조", jo):
        key = re.match(r"^제\d+조(?:의\d+)?", jo).group()
        if not re.search(re.escape(key).replace(r"\ ", r"\s*"), bodies):
            errs.append(f"{where}: {name} '{key}' — 본문에 없음")
    elif jo.startswith("별표"):
        core = jo.split("(")[0].strip()  # '별표(1.복무 …)' 같은 주석 괄호는 제외하고 대조
        pat = re.escape(core).replace(r"\ ", r"\s*")
        if not re.search(pat, bodies):
            errs.append(f"{where}: {name} '{core}' — 본문에 없음")
    else:
        if jo.split("(")[0].strip() not in bodies:
            errs.append(f"{where}: {name} '{jo}' — 본문에 해당 텍스트 없음")


def lint(journey: dict, titles: dict, erp_bodies: str) -> list:
    errs = []
    for f in ("id", "title", "emoji", "요약", "검수상태", "lanes", "stages", "nodes", "edges"):
        if f not in journey:
            errs.append(f"필수 필드 누락: {f}")
    if errs:
        return errs
    lanes, stages = set(journey["lanes"]), set(journey["stages"])
    ids = set()
    for n in journey["nodes"]:
        w = f"노드 {n.get('id')}({n.get('name', '?')})"
        ids.add(n.get("id"))
        if n.get("lane") not in lanes:
            errs.append(f"{w}: lane '{n.get('lane')}' 미정의")
        if n.get("stage") not in stages:
            errs.append(f"{w}: stage '{n.get('stage')}' 미정의")
        if not n.get("근거"):
            errs.append(f"{w}: 근거 없음(⛔ 근거 없는 노드 금지)")
        for b in n.get("근거", []):
            check_basis(b, titles, errs, w)
        if n.get("기한"):
            check_basis(n["기한"].get("근거", {}), titles, errs, f"{w}·기한")
        if n.get("전결"):
            check_basis(n["전결"].get("근거", {}), titles, errs, f"{w}·전결")
        if n.get("erp"):
            code = n["erp"].get("코드", "")
            if code and code not in erp_bodies:
                errs.append(f"{w}: ERP 코드 '{code}' — 40_시스템 노트에 없음")
        if MONEY_RE.search(n.get("action", "")):
            errs.append(f"{w}: action에 금액 수치 기입 금지 — '{MONEY_RE.search(n['action']).group()}'")
    for a, b in journey["edges"]:
        if a not in ids or b not in ids:
            errs.append(f"edge {a}→{b}: 미정의 노드")
    if journey.get("검수상태") not in ("미검수", "검수완료"):
        errs.append("검수상태는 미검수|검수완료")
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault", required=True)
    ap.add_argument("--file", default="", help="단일 파일만 검사(기본: _journeys 전체)")
    args = ap.parse_args()
    vault = Path(args.vault)
    titles = build_title_index(vault)
    erp_bodies = "\n".join("\n".join(v) for k, v in titles.items()
                           if any(w in k for w in ("ERP", "전자결재", "연구관리", "그룹웨어")))

    files = [Path(args.file)] if args.file else sorted((vault / "90_관리" / "_journeys").glob("*.json"))
    total_err = 0
    for f in files:
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"❌ {f.name}: JSON 파싱 실패 — {e}")
            total_err += 1
            continue
        errs = lint(j, titles, erp_bodies)
        if errs:
            total_err += len(errs)
            print(f"❌ {f.name}: 위반 {len(errs)}건")
            for e in errs:
                print(f"    - {e}")
        else:
            print(f"✅ {f.name}: 노드 {len(j['nodes'])} · 근거 {sum(len(n.get('근거', [])) for n in j['nodes'])}건 전부 대조 통과")
    if total_err:
        print(f"\n❌ 총 {total_err}건 위반 — 반영 금지")
        sys.exit(1)
    print("\n✅ 여정 무결성 전부 통과")


if __name__ == "__main__":
    main()
