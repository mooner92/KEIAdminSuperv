#!/usr/bin/env python3
"""mlflow_log.py — 일일 자가평가 결과를 MLflow Tracking에 병행 기록 (specs/10 T02·T03).

⛔ 병행 기록 원칙: 정본은 graded.json·게시판 그대로 — 여기 실패해도 크론은 정상이어야
   한다(daily_run.sh 훅이 `|| true`). MLflow는 운영자 실험 비교용 두 번째 시선이다.
⛔ 백필 시 과거 구성(param)은 추측하지 않는다 — 오늘 env를 과거 run에 붙이면 "리랭커
   전후 비교"가 거짓말이 된다. 모르는 과거 param은 비워 둔다(절대규칙 1과 동형).
저장 = eval/mlflow.db(sqlite, 서버 불요) + eval/mlruns/(artifact) — 둘 다 gitignore(본문 포함, 공개 금지).
실행: cd eval && ../tools/.venv/bin/python mlflow_log.py --date 2026-08-02
      백필:                          … mlflow_log.py --backfill
      UI:   cd eval && ../tools/.venv/bin/mlflow ui --port 5000   (127.0.0.1, 필요할 때만)
"""
import argparse
import json
import os
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
DAILY = HERE / "daily"


def _params_now() -> dict:
    """현재 실구성 — 재현성의 핵심. env 우선(크론이 PM2 밖이라 기본값 폴백 명시)."""
    return {
        "llm": os.environ.get("LLM_MODEL", "hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M"),
        "collection": os.environ.get("RAG_COLLECTION", "kei_regs"),
        "rerank": os.environ.get("RAG_RERANK", "1"),
        "topk": os.environ.get("RAG_TOPK", "5"),
    }


def _git_short() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=HERE,
                              capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:  # noqa: BLE001
        return ""


def log_one(date: str, with_params: bool) -> bool:
    f = DAILY / f"{date}.graded.json"
    if not f.exists():
        print(f"  건너뜀 {date}(graded 없음)")
        return False
    import mlflow  # 지연 import — 미설치 환경에서 크론 훅이 즉사하지 않게
    # ⚠ 실측(3.15): 파일 스토어는 유지보수 모드 예외 — sqlite가 권장 경로(여전히 서버 불요).
    mlflow.set_tracking_uri(f"sqlite:///{HERE / 'mlflow.db'}")
    mlflow.set_experiment("daily-eval")
    d = json.loads(f.read_text(encoding="utf-8"))
    metrics = {"정답률": float(d.get("정답률") or 0)}
    for name, c in (d.get("코호트별") or {}).items():
        metrics[f"코호트_{name}"] = float(c.get("정답률") or 0)
        metrics[f"코호트_{name}_문항수"] = float(c.get("문항수") or 0)
    for name, n in (d.get("실패유형별") or {}).items():
        metrics[f"실패_{name}"] = float(n)
    for name, n in (d.get("집계") or {}).items():
        metrics[f"집계_{name}"] = float(n)
    with mlflow.start_run(run_name=date):
        if with_params:  # ⛔ 백필(과거)엔 붙이지 않는다 — 당시 구성을 모른다
            mlflow.log_params(_params_now())
        mlflow.log_metrics(metrics)
        mlflow.set_tags({"git": _git_short(), "trigger": os.environ.get("MLFLOW_TRIGGER", "manual"),
                         "backfill": "0" if with_params else "1"})
        mlflow.log_artifact(str(f))
    print(f"  ✓ {date}: metrics {len(metrics)}개" + ("" if with_params else " (백필 — param 미기록)"))
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date")
    ap.add_argument("--backfill", action="store_true", help="기존 graded 전부 소급(param 미기록)")
    a = ap.parse_args()
    if a.backfill:
        n = sum(log_one(f.name.split(".")[0], with_params=False)
                for f in sorted(DAILY.glob("*.graded.json")))
        print(f"백필 {n}건")
        return 0
    if not a.date:
        ap.error("--date 또는 --backfill")
    return 0 if log_one(a.date, with_params=True) else 1


if __name__ == "__main__":
    raise SystemExit(main())
