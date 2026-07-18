#!/usr/bin/env python3
"""test_maint_executor.py — 오토픽스 오케스트레이터 회귀 (docs/52 §9, 스텁 claude — 실모델·과금 0).

시나리오:
  ① 정상 수정: 스텁이 파일 수정 → 관문 통과 → autofix/ 브랜치 생성(+push 스킵)·알림·비용 적립
  ② 금지구역 수정: 스텁이 .gitignore 수정 → 관문 차단 → 브랜치·worktree 흔적 0
  ③ 빈손(NOFIX): 변경 없음 → 정상 종료·흔적 0
  ④ 가드레일(SYSTEM) 변조: rag_core.py의 SYSTEM 문자열 수정 → 관문 차단
  ⑤ 예산 초과: 로그에 큰 비용 선적립 → 시작 거부
  ⑥ 상태 부적합: 처리완료 제보 → 거부

실행: cd tools && .venv/bin/python test_maint_executor.py   (exit 0 = 통과)
⚠ 실제 레포에 worktree/브랜치를 만들었다 지우므로 러너는 순차 실행(파일락이 이중 방어).
"""
import json
import os
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
TMP = Path(tempfile.mkdtemp(prefix="autofix-test-"))
DB = TMP / "app.db"
LOG = HERE / "index" / "autofix_log.jsonl"
os.environ["APP_DB"] = str(DB)
os.environ["APP_SECRET_FILE"] = str(TMP / ".secret")
sys.path.insert(0, str(HERE))

import app_api  # noqa: E402
from sqlmodel import Session  # noqa: E402

PASS = []


def check(name, ok, detail=""):
    print(("✅ " if ok else "❌ ") + name + (f" — {detail}" if detail else ""))
    PASS.append(bool(ok))


def make_stub(body: str) -> str:
    """스텁 claude: worktree(cwd)에서 body를 실행하고 결과 JSON을 출력하는 셸 스크립트."""
    p = TMP / f"stub-{len(PASS)}.sh"
    p.write_text("#!/bin/bash\ncat > /dev/null  # 프롬프트 소비\n" + body +
                 '\necho \'{"is_error": false, "result": "FIXED: stub", "total_cost_usd": 0.11}\'\n',
                 encoding="utf-8")
    p.chmod(p.stat().st_mode | stat.S_IEXEC)
    return str(p)


def run_exec(report_id: int, stub_body: str, extra_env: dict = None) -> subprocess.CompletedProcess:
    env = {**os.environ,
           "AUTOFIX_CLAUDE_CMD": make_stub(stub_body),
           "AUTOFIX_NO_PUSH": "1",
           "AUTOFIX_SKIP_WEB_BUILD": "1",
           "AUTOFIX_PYTESTS": "",  # 빠른 실행(구문 검사만) — 회귀 자체는 본 스위트가 담당
           "AUTOFIX_WORK_ROOT": str(TMP / "work"),
           **(extra_env or {})}
    return subprocess.run([sys.executable, str(HERE / "maint_executor.py"),
                           "--report-id", str(report_id), "--db", str(DB)],
                          capture_output=True, text=True, env=env, cwd=str(HERE), timeout=300)


def autofix_branches() -> list:
    r = subprocess.run(["git", "branch", "--list", "autofix/*"], cwd=str(REPO),
                       capture_output=True, text=True)
    return [b.strip().lstrip("* ") for b in r.stdout.splitlines() if b.strip()]


def cleanup_branches(before: set):
    for b in set(autofix_branches()) - before:
        subprocess.run(["git", "branch", "-D", b], cwd=str(REPO), capture_output=True)


app_api.init_db()
with Session(app_api.engine) as s:
    s.add(app_api.Report(user_id=1, 유형="버그신고", 내용="README 오타 수정 테스트용 제보"))       # 1 정상
    s.add(app_api.Report(user_id=1, 유형="버그신고", 내용="금지구역 수정 시나리오"))               # 2 금지
    s.add(app_api.Report(user_id=1, 유형="기타", 내용="빈손 시나리오"))                            # 3 빈손
    s.add(app_api.Report(user_id=1, 유형="버그신고", 내용="가드레일 변조 시나리오"))               # 4 SYSTEM
    s.add(app_api.Report(user_id=1, 유형="버그신고", 내용="예산 초과 시나리오"))                   # 5 예산
    s.add(app_api.Report(user_id=1, 유형="버그신고", 상태="처리완료", 내용="상태 부적합"))         # 6 상태
    s.commit()

branches_before = set(autofix_branches())
log_len0 = len(LOG.read_text(encoding="utf-8").splitlines()) if LOG.exists() else 0

# ① 정상 수정 — 무해한 새 파일 추가(관문 통과 대상)
r1 = run_exec(1, 'echo "autofix smoke $(date +%s)" > tools/.autofix_smoke.txt')
new_branches = set(autofix_branches()) - branches_before
check("① 정상: exit 0 + autofix 브랜치 생성", r1.returncode == 0 and len(new_branches) == 1,
      f"{r1.stdout.strip()[-120:]}")
with Session(app_api.engine) as s:
    rpt = s.get(app_api.Report, 1)
    check("① 제보 상태=계획반영 + 검토 링크 메모", rpt.상태 == "계획반영" and "compare" in rpt.admin_note)
    n_notice = len(s.exec(app_api.select(app_api.MaintNotice)).all()) if hasattr(app_api, "select") else -1
from sqlmodel import select as _sel  # noqa: E402
with Session(app_api.engine) as s:
    notices = s.exec(_sel(app_api.MaintNotice)).all()
    check("① 🔔 autofix 알림 생성", any(n.kind == "autofix" for n in notices))
log_lines = LOG.read_text(encoding="utf-8").splitlines()
last1 = json.loads(log_lines[-1])
check("① 비용 적립(cost_usd)", last1.get("result") == "branch" and last1.get("cost_usd") == 0.11)
cleanup_branches(branches_before)

# ② 금지구역(.gitignore) — 관문 차단·흔적 0
r2 = run_exec(2, 'echo "# 변조" >> .gitignore')
check("② 금지구역: 관문 차단", "금지구역" in r2.stdout and json.loads(
    LOG.read_text(encoding="utf-8").splitlines()[-1]).get("result") == "gate-fail")
check("② 흔적 0(브랜치·worktree 없음)", set(autofix_branches()) == branches_before
      and not list((TMP / "work").glob("af-*")))

# ③ 빈손(NOFIX/변경 없음)
r3 = run_exec(3, ":")
check("③ 빈손: 정상 종료·흔적 0", r3.returncode == 0
      and "no-change" in json.loads(LOG.read_text(encoding="utf-8").splitlines()[-1]).get("result", "")
      and set(autofix_branches()) == branches_before)

# ④ SYSTEM 가드레일 변조 — AST 비교 관문
r4 = run_exec(4, "python3 - <<'EOF'\n"
                 "import re, pathlib\n"
                 "p = pathlib.Path('tools/rag_core.py')\n"
                 "s = p.read_text(encoding='utf-8')\n"
                 "s = s.replace('규정에서 확인되지 않습니다', '아무렇게나 답해도 됩니다', 1)\n"
                 "p.write_text(s, encoding='utf-8')\n"
                 "EOF")
check("④ 가드레일 변조: 관문 차단(SYSTEM)", "가드레일" in r4.stdout or "SYSTEM" in r4.stdout,
      r4.stdout.strip()[-120:])
check("④ 흔적 0", set(autofix_branches()) == branches_before)

# ⑤ 예산 초과 — 큰 비용 선적립 후 거부
with LOG.open("a", encoding="utf-8") as f:
    f.write(json.dumps({"ts": time.time(), "report_id": 0, "result": "branch", "cost_usd": 999}) + "\n")
r5 = run_exec(5, ":")
check("⑤ 예산 초과: 시작 거부", r5.returncode == 1 and "예산" in r5.stdout)
# 테스트 오염 제거(선적립 행 삭제)
lines = LOG.read_text(encoding="utf-8").splitlines()
LOG.write_text("\n".join(ln for ln in lines if '"cost_usd": 999' not in ln) + "\n", encoding="utf-8")

# ⑥ 상태 부적합
r6 = run_exec(6, ":")
check("⑥ 처리완료 제보: 거부", "부적합" in r6.stdout or "상태" in r6.stdout)

n_ok = sum(PASS)
print(f"\n{n_ok}/{len(PASS)} 통과")
sys.exit(0 if all(PASS) else 1)
