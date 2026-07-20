#!/usr/bin/env python3
"""maint_executor.py — 오토픽스 결정적 오케스트레이터 (docs/52 §9, Phase A).

역할: G2 제보 1건을 받아 격리 worktree에서 무인 Claude Code(claude -p)로 수정하고,
결정적 관문(금지구역 diff·구문·빠른 회귀·웹 빌드)을 통과하면 autofix/<id> 브랜치를
push + GitHub compare URL을 관리자에게 알린다. 실패·빈손이면 흔적 0으로 폐기.

⛔ 설계 불변식(docs/52 §2·§9):
  - 이 스크립트는 LLM이 아니다 — 무엇이 실행되는지 코드로 감사 가능.
  - Claude에 Bash 미부여(수정만) — 검증은 이 관문이 수행.
  - 본선 직접 커밋 불가(항상 autofix/ 브랜치) — 머지·배포는 사람.
  - 금지구역은 audit.soul(지시) + 여기 결정적 diff 검사(강제)로 이중 방어.

실행: cd tools && .venv/bin/python maint_executor.py --report-id N [--db app.db]
테스트: AUTOFIX_CLAUDE_CMD=<스텁 스크립트> AUTOFIX_NO_PUSH=1 (회귀=test_maint_executor.py)
"""
import argparse
import ast
import datetime
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
LOG = HERE / "index" / "autofix_log.jsonl"
WORK_ROOT = Path(os.environ.get("AUTOFIX_WORK_ROOT", str(Path.home() / "kei-autofix")))
BUDGET_USD = float(os.environ.get("AUTOFIX_BUDGET_USD", "20"))
MAX_TURNS = int(os.environ.get("AUTOFIX_MAX_TURNS", "30"))
TIMEOUT_S = int(os.environ.get("AUTOFIX_TIMEOUT_S", "1200"))
BASE_BRANCH = os.environ.get("AUTOFIX_BASE_BRANCH", "feat/krds")
COMPARE_BASE = "https://github.com/mooner92/KEIAdminSuperv/compare"

# ⛔ 금지구역(경로 프리픽스/패턴) — audit.soul과 동기. 하나라도 diff에 걸리면 전체 폐기.
FORBIDDEN_PATHS = (
    "KEI-행정가이드/", "rule_files/", "research_rule_files/", "external_affairs_raw/",
    "manual/", ".github/", ".githooks/", ".gitignore",
    "tools/.app_secret", "tools/app.db", "tools/.anthropic_key", "tools/audit.soul",
)
FORBIDDEN_SUFFIX = (".hwp", ".hwpx")


def log_run(entry: dict) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    entry = {"ts": round(time.time(), 1), **entry}
    with LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def month_spend() -> float:
    """이번 달 오토픽스 누적 비용(USD) — 예산 가드."""
    if not LOG.exists():
        return 0.0
    month = datetime.datetime.now().strftime("%Y-%m")
    total = 0.0
    for line in LOG.read_text(encoding="utf-8").splitlines():
        try:
            e = json.loads(line)
            if datetime.datetime.fromtimestamp(e["ts"]).strftime("%Y-%m") == month:
                total += float(e.get("cost_usd", 0) or 0)
        except Exception:  # noqa: BLE001
            continue
    return total


def _git(args: list, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=str(cwd), capture_output=True, text=True, timeout=120)


def _extract_system_prompt(py_src: str) -> str:
    """rag_core.py의 SYSTEM 가드레일 문자열을 AST로 추출(변경 감지용 — 절대 규칙 4)."""
    try:
        tree = ast.parse(py_src)
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                for t in node.targets:
                    if isinstance(t, ast.Name) and t.id == "SYSTEM":
                        return ast.get_source_segment(py_src, node.value) or ""
    except SyntaxError:
        return "<SYNTAX-ERROR>"
    return ""


def _flag_defaults(py_src: str) -> list:
    """app_api.py FLAG_REGISTRY의 default 값 나열(순서 보존) — 기본값 변조 감지."""
    m = re.search(r"FLAG_REGISTRY[\s\S]*?\n\}", py_src)
    return re.findall(r'"default":\s*(True|False)', m.group(0)) if m else []


def gate_forbidden(wt: Path, changed: list) -> str:
    """금지구역 관문. 위반 사유 문자열 반환(빈 문자열=통과)."""
    for p in changed:
        if p.startswith(FORBIDDEN_PATHS) or p.endswith(FORBIDDEN_SUFFIX):
            return f"금지구역 수정: {p}"
    if "tools/rag_core.py" in changed:
        base = _extract_system_prompt((REPO / "tools" / "rag_core.py").read_text(encoding="utf-8"))
        new = _extract_system_prompt((wt / "tools" / "rag_core.py").read_text(encoding="utf-8"))
        if base != new:
            return "RAG 가드레일(SYSTEM) 변경 — 절대 규칙 4"
    if "tools/app_api.py" in changed:
        base = _flag_defaults((REPO / "tools" / "app_api.py").read_text(encoding="utf-8"))
        new = _flag_defaults((wt / "tools" / "app_api.py").read_text(encoding="utf-8"))
        if base != new:
            return "기능 플래그 기본값 변경 — release 관례 위반"
    return ""


def gate_python(wt: Path, changed: list) -> str:
    """Python 관문: 변경 .py 전부 구문 검사 + 빠른 회귀(스텁 기반 — LLM·GPU 불요)."""
    pys = [p for p in changed if p.endswith(".py")]
    if not pys:
        return ""
    for p in pys:
        try:
            ast.parse((wt / p).read_text(encoding="utf-8"))
        except SyntaxError as e:
            return f"구문 오류: {p} — {e}"
    tests = [t for t in os.environ.get("AUTOFIX_PYTESTS", "test_feedback_gates.py").split(",") if t.strip()]
    for t in tests:
        tp = wt / "tools" / t.strip()
        if not tp.exists():
            continue
        r = subprocess.run([str(HERE / ".venv" / "bin" / "python"), str(tp)],
                           cwd=str(wt / "tools"), capture_output=True, text=True, timeout=600,
                           env={**os.environ, "APP_DB": ""})  # 테스트는 자체 임시 DB 사용
        if r.returncode != 0:
            return f"회귀 실패: {t} — {r.stdout.strip()[-300:]}"
    return ""


def gate_web(wt: Path, changed: list) -> str:
    """웹 관문: web/ 변경 시 정적 빌드(Node22·dev 볼트 read-only)."""
    if not any(p.startswith("web/") for p in changed):
        return ""
    if os.environ.get("AUTOFIX_SKIP_WEB_BUILD") == "1":  # 회귀 테스트 전용(빌드 수 분 소요)
        return ""
    # git worktree엔 node_modules(비추적)가 없어 next 실행 불가 → 원본 레포에서 심링크.
    # 의존성은 브랜치 무관(package.json 동일)이라 안전. 이미 있으면(재시도) 건너뜀.
    wt_nm = wt / "web" / "node_modules"
    if not wt_nm.exists():
        src_nm = REPO / "web" / "node_modules"
        if not src_nm.exists():
            return "원본 web/node_modules 없음 — 먼저 npm install 필요"
        try:
            wt_nm.symlink_to(src_nm)
        except OSError as e:
            return f"node_modules 링크 실패 — {e}"
    nvm = 'export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22 >/dev/null'
    r = subprocess.run(["bash", "-c", f'{nvm} && cd "{wt}/web" && VAULT_DIR="{REPO}/KEI-행정가이드" npm run build'],
                       capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        return f"웹 빌드 실패 — {(r.stderr or r.stdout).strip()[-300:]}"
    return ""


def save_diff(af_id: str, wt: Path, changed: list) -> Path | None:
    """관문 실패로 worktree를 폐기하기 전, claude가 만든 변경(changed 경로만)을 diff로 보존.
    실패가 '코드 탓'인지 '환경 탓'(#31 node_modules 사례)인지 사후 판별용.
    changed는 관문 실행 전 스냅샷이라 관문 산출물(심링크 등)은 애초에 포함 안 됨."""
    paths = [p for p in changed if p]
    if not paths:
        return None
    try:
        subprocess.run(["git", "add", "--", *paths], cwd=str(wt), capture_output=True, timeout=30)
        r = subprocess.run(["git", "diff", "--cached", "--", *paths],
                           cwd=str(wt), capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    if not r.stdout.strip():
        return None
    dst = HERE / "index" / "autofix_diffs" / f"{af_id}.diff"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(r.stdout, encoding="utf-8")
    return dst


def run_claude(wt: Path, prompt: str) -> dict:
    """무인 Claude Code 실행 — Bash 미부여(수정만). 반환: 결과 JSON(dict)."""
    cmd_override = os.environ.get("AUTOFIX_CLAUDE_CMD", "")
    if cmd_override:  # 회귀 테스트 스텁: 프롬프트를 stdin으로 받아 JSON을 stdout으로
        r = subprocess.run([cmd_override], cwd=str(wt), input=prompt,
                           capture_output=True, text=True, timeout=TIMEOUT_S)
    else:
        r = subprocess.run(
            ["claude", "-p", prompt, "--output-format", "json",
             "--max-turns", str(MAX_TURNS),
             "--allowedTools", "Read,Glob,Grep,Edit,Write"],
            cwd=str(wt), capture_output=True, text=True, timeout=TIMEOUT_S)
    try:
        return json.loads(re.search(r"\{[\s\S]*\}", r.stdout).group(0))
    except Exception:  # noqa: BLE001
        return {"is_error": True, "result": (r.stdout or r.stderr)[-500:]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report-id", type=int, required=True)
    ap.add_argument("--db", default=str(HERE / "app.db"))
    args = ap.parse_args()

    os.environ.setdefault("APP_DB", args.db)
    sys.path.insert(0, str(HERE))
    import app_api  # noqa: PLC0415
    from sqlmodel import Session  # noqa: PLC0415

    # 동시 1개 락 + 예산 가드
    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    lock_f = (WORK_ROOT / ".autofix.lock").open("w")
    try:
        fcntl.flock(lock_f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("다른 오토픽스 실행 중 — 스킵")
        return 0
    spent = month_spend()
    if spent >= BUDGET_USD:
        log_run({"report_id": args.report_id, "result": "budget-refused", "spent": round(spent, 2)})
        print(f"⛔ 월 예산 초과({spent:.2f}/{BUDGET_USD} USD) — 시작 거부")
        return 1

    app_api.init_db()
    with Session(app_api.engine) as s:
        rpt = s.get(app_api.Report, args.report_id)
        if not rpt or rpt.상태 not in ("접수", "분석됨"):
            print(f"제보 #{args.report_id} 없음 또는 상태 부적합({rpt.상태 if rpt else '없음'})")
            return 1
        report_txt = (f"유형: {rpt.유형}\n대상: {rpt.대상규정} {rpt.대상조문}\n"
                      f"내용:\n{rpt.내용}")
        group = rpt.analysis_group

    # 분석 보고서(있으면)에서 이 그룹의 파일 후보·원인분석을 재료로 첨부(진단은 Claude가 새로)
    plan_ctx = ""
    if group and "#" in group:
        pj = HERE / "index" / "feedback_plans" / (group.split("#")[0] + ".json")
        if pj.exists():
            try:
                for g in json.loads(pj.read_text(encoding="utf-8")).get("groups", []):
                    if args.report_id in g.get("report_ids", []):
                        plan_ctx = (f"\n\n## (참고) 사전 분석 — 신뢰하지 말고 재검증하라\n"
                                    f"요약: {g.get('요약', '')}\n원인 가설: {g.get('원인분석', '')}")
                        break
            except Exception:  # noqa: BLE001
                pass

    # worktree 격리 생성
    af_id = f"{args.report_id}-{datetime.datetime.now().strftime('%m%d%H%M')}"
    branch = f"autofix/{af_id}"
    wt = WORK_ROOT / f"af-{af_id}"
    r = _git(["worktree", "add", str(wt), "-b", branch, BASE_BRANCH], REPO)
    if r.returncode != 0:
        log_run({"report_id": args.report_id, "result": "worktree-fail", "err": r.stderr[-200:]})
        return 1

    def cleanup(keep_branch: bool = False):
        _git(["worktree", "remove", "--force", str(wt)], REPO)
        if not keep_branch:
            _git(["branch", "-D", branch], REPO)

    try:
        soul = (HERE / "audit.soul").read_text(encoding="utf-8")
        prompt = f"{soul}\n\n## 처리할 제보 (#{args.report_id})\n{report_txt}{plan_ctx}"
        t0 = time.time()
        res = run_claude(wt, prompt)
        cost = float(res.get("total_cost_usd", 0) or 0)
        result_txt = str(res.get("result", ""))[:1000]

        # 관문 0: 변경 파일 수집
        st = _git(["status", "--porcelain"], wt)
        changed = [ln[3:].strip().strip('"') for ln in st.stdout.splitlines() if ln.strip()]
        if res.get("is_error") or not changed or "NOFIX:" in result_txt:
            cleanup()
            why = "빈손(NOFIX)" if "NOFIX:" in result_txt else ("오류" if res.get("is_error") else "변경 없음")
            log_run({"report_id": args.report_id, "result": f"no-change:{why}",
                     "cost_usd": cost, "dur_s": round(time.time() - t0)})
            _notify(app_api, f"오토픽스 #{args.report_id}: 수정 없이 종료({why})",
                    result_txt[:300], ok=False)
            print(f"[af-{af_id}] {why} — 흔적 0 폐기. {result_txt[:200]}")
            return 0

        # 관문 1~3: 금지구역 → 구문·회귀 → 웹 빌드 (하나라도 걸리면 전체 폐기)
        for gate_fn in (gate_forbidden, gate_python, gate_web):
            verdict = gate_fn(wt, changed)
            if verdict:
                diff_path = save_diff(af_id, wt, changed)  # 폐기 전 claude 변경 보존(코드 vs 환경 진단)
                cleanup()
                log_run({"report_id": args.report_id, "result": "gate-fail",
                         "gate": gate_fn.__name__, "why": verdict, "cost_usd": cost,
                         "files": changed, "diff": str(diff_path) if diff_path else None})
                _notify(app_api, f"오토픽스 #{args.report_id}: 관문 차단({gate_fn.__name__})",
                        verdict + (f" · 변경 {len(changed)}파일 보존({diff_path.name})" if diff_path else ""),
                        ok=False)
                print(f"[af-{af_id}] ⛔ {verdict} — 폐기"
                      + (f" (diff 보존: {diff_path})" if diff_path else ""))
                return 0

        # 커밋 + push + 알림
        # ⚠ git add -A 금지 — 관문(gate_web)이 만든 node_modules 심링크·빌드 산출물이
        # 섞여 들어간다. claude가 실제 바꾼 파일(changed, 관문 전 스냅샷)만 스테이징.
        _git(["add", "--"] + changed, wt)
        _git(["commit", "-m",
              f"autofix(#{args.report_id}): {rpt.유형} — {rpt.대상규정 or rpt.내용[:40]}\n\n"
              f"무인 수정(docs/52 Phase A). 관문: 금지구역·구문·회귀·빌드 통과.\n"
              f"{result_txt.splitlines()[0][:100] if result_txt else ''}\n\n"
              f"Co-Authored-By: Claude (autofix) <noreply@anthropic.com>"], wt)
        pushed = True
        if os.environ.get("AUTOFIX_NO_PUSH") != "1":
            pr_ = _git(["push", "origin", branch], wt)
            pushed = pr_.returncode == 0
        compare = f"{COMPARE_BASE}/{BASE_BRANCH.replace('/', '%2F')}...{branch.replace('/', '%2F')}?expand=1"
        cleanup(keep_branch=True)

        with Session(app_api.engine) as s:
            rpt2 = s.get(app_api.Report, args.report_id)
            rpt2.상태 = "계획반영"
            rpt2.admin_note = (rpt2.admin_note + f"\n[오토픽스] 브랜치 {branch} 생성"
                               + (f" — 검토: {compare}" if pushed else " (push 실패 — 로컬 브랜치)")).strip()
            rpt2.updated_at = time.time()
            s.add(rpt2)
            s.commit()
        _notify(app_api, f"🤖 오토픽스 #{args.report_id}: 수정 브랜치 준비 — diff 검토 후 머지하세요",
                f"{branch} · {result_txt.splitlines()[0][:120] if result_txt else ''} · {compare}", ok=True)
        log_run({"report_id": args.report_id, "result": "branch", "branch": branch,
                 "files": changed, "cost_usd": cost, "dur_s": round(time.time() - t0),
                 "pushed": pushed})
        print(f"[af-{af_id}] ✅ {branch} ({len(changed)}파일, ${cost:.2f}) → {compare}")
        return 0
    except Exception as e:  # noqa: BLE001
        cleanup()
        log_run({"report_id": args.report_id, "result": "error", "err": str(e)[:300]})
        print(f"[af-{af_id}] 예외 — 폐기: {e}")
        return 1


def _notify(app_api, summary: str, detail: str, ok: bool) -> None:
    from sqlmodel import Session  # noqa: PLC0415
    with Session(app_api.engine) as s:
        s.add(app_api.MaintNotice(kind="autofix" if ok else "autofix-fail",
                                  summary=summary, detail_path=detail[:500]))
        s.commit()


if __name__ == "__main__":
    sys.exit(main())
