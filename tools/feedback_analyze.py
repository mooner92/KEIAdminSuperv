#!/usr/bin/env python3
"""feedback_analyze.py — 제보 자동 분석·유지보수 계획안 생성 (docs/51 §5).

매시간(PM2 cron_restart) 실행:
  1. 상태='접수' 제보 조회 — 0건이면 LLM 호출 없이 run_log에 '없음' 기록 후 종료.
  2. 중복 방지 컨텍스트(최근 계획 항목 + 처리·중복 제보 제목) 로드.
  3. 로컬 LLM(기존 스택: VLLM_BASE/LLM_MODEL, Qwen3.5 사고 off) 1회 호출 —
     신규 그룹화 + 기존 반영분 중복 판정 + 로컬조치/코드작업 분류 → JSON.
  4. plan_YYYYMMDD_HHMM.json + 사람용 .md 계획안 저장, run_log 기록.
  5. 제보 상태=분석됨|중복 + analysis_group 반영.
  6. MaintNotice 생성(계획 있을 때만) + SMTP_URL 설정 시 이메일 시도(실패 무시).

⛔ 안전: 볼트·코퍼스·검수상태를 절대 수정하지 않는다 — 계획·알림·제보 워크플로 상태만.
테스트: FB_ANALYZE_STUB=<json경로> 로 LLM 응답을 파일로 대체(실모델 불필요).

실행: cd tools && .venv/bin/python feedback_analyze.py [--db app.db] [--dry]
"""
import argparse
import datetime
import json
import os
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLANS = HERE / "index" / "feedback_plans"
RUN_LOG = PLANS / "run_log.jsonl"

PROMPT = """당신은 KEI 행정 가이드 서비스의 유지보수 계획 담당입니다.
사용자 제보들을 분석해 유지보수 계획을 JSON으로만 답하세요(설명 금지).

## 신규 제보 (id: 유형/대상/내용)
{new_reports}

## 코퍼스 대조 — 오류/누락 제보의 관련 근거 (검색 결과)
{rag_context}

## 이미 계획·처리된 항목(이것과 같은 사안이면 중복입니다)
{known_items}

## 규칙
- 같은 사안의 신규 제보는 하나의 그룹으로 묶는다.
- duplicates는 **'이미 계획·처리된 항목' 목록에 실제로 같은 사안이 존재할 때만** 넣는다.
  목록에 비슷한 항목이 없으면 중복이 아니다 — 확신이 없으면 그룹으로 만든다.
- **'코퍼스 대조'를 근거로 신빙성을 판단한다**:
  - 오류신고: 관련 근거가 검색되면 그 문서/조문이 실존한다는 뜻 → 화면·표 문제로 다룬다.
    관련 근거가 전혀 없으면 대상 문서명이 틀렸을 수 있으니 요약에 그 점을 적는다.
  - 누락신고: 관련 근거가 **검색되지 않으면** 코퍼스에 없을 가능성이 높다 → 개정본/문서 반입(로컬조치)
    신빙성 높음. 반대로 이미 검색되면 '있는데 사용자가 못 찾은' 경우일 수 있으니 안내·검색 개선으로 본다.
  - ⛔ 근거의 규정 내용(금액·기한 등)을 계획에 옮겨 적지 말 것 — 실존/부재 판단에만 쓴다.
- 각 그룹의 조치구분:
  - "로컬조치": 서버·관리 화면에서 운영으로 해결(예: 부서에 개정본 요청 후 관리자 업로드→재색인,
    검수 우선순위 조정, 기능 켜기/끄기, 안내 문구). 코드 수정 불필요.
  - "코드작업": 프로그램 수정 필요(화면 버그, 변환·검색 파이프라인 수정, 기능 추가) — Claude Code 작업.
- 제안절차는 실행 가능한 단계 2~5개. 추측한 규정 내용(금액·기한)은 절대 쓰지 않는다.

## 출력(JSON만)
{{"groups": [{{"제목": str, "조치구분": "로컬조치"|"코드작업", "요약": str,
  "제안절차": [str], "report_ids": [int], "우선순위": "높음"|"보통"|"낮음"}}],
 "duplicates": [{{"report_id": int, "이유": str}}]}}"""


RAG_TYPES = {"오류신고", "누락신고"}  # 코퍼스 대조가 신빙성 판단에 필요한 유형(docs/51 §5)


def _rag_context(reports) -> str:
    """오류/누락 제보를 볼트에서 검색해 '실존/부재' 근거를 프롬프트에 붙인다(docs/51 §5).
    ⚠ 임베더 로딩이 무거우므로 해당 유형 제보가 있을 때만 backend를 깨운다. 검색만(리랭커 off).
    실패(chroma 없음 등)해도 파이프라인은 계속 — 그 경우 빈 대조로 진행(구 동작)."""
    if os.environ.get("FB_ANALYZE_RAG", "1") == "0" or os.environ.get("FB_ANALYZE_STUB"):
        return "(코퍼스 대조 비활성)"  # 스텁 테스트는 결정적 유지 — 임베더 로딩·검색 생략
    targets = [r for r in reports if r.유형 in RAG_TYPES]
    if not targets:
        return "(오류/누락 제보 없음 — 대조 불필요)"
    try:
        sys.path.insert(0, str(HERE))
        import rag_core  # noqa: PLC0415
    except Exception as e:  # noqa: BLE001
        return f"(코퍼스 대조 불가: {e})"
    lines = []
    for r in targets:
        query = f"{r.대상규정} {r.대상조문} {r.내용[:200]}".strip()
        try:
            _, srcs = rag_core.retrieve(query, k=3, rerank=False)
        except Exception as e:  # noqa: BLE001
            lines.append(f"- 제보 #{r.id}: (검색 실패: {e})")
            continue
        if not srcs:
            lines.append(f"- 제보 #{r.id} [{r.유형}] '{r.대상규정}': 관련 근거 0건 — 코퍼스에 없음(부재 신호)")
            continue
        ev = " · ".join(f"{s.get('규정명', '')} {s.get('조', '')}".strip() for s in srcs[:3])
        lines.append(f"- 제보 #{r.id} [{r.유형}] '{r.대상규정}': 관련 근거 {len(srcs)}건 → {ev}")
    return "\n".join(lines) or "(대조 결과 없음)"


def _llm_call(prompt: str) -> str:
    stub = os.environ.get("FB_ANALYZE_STUB", "")
    if stub:
        return Path(stub).read_text(encoding="utf-8")
    # rag_core와 동일 스택(VLLM_BASE/LLM_MODEL + qwen3.5 사고 off)이되, backend()는 부르지
    # 않는다 — 임베더까지 로드해 매시간 실행에 과함. 가벼운 자체 클라이언트 사용.
    sys.path.insert(0, str(HERE))
    import rag_core  # noqa: PLC0415 — _gen_extra(사고 off 옵션)만 재사용(모듈 임포트는 가벼움)
    from openai import OpenAI  # noqa: PLC0415
    client = OpenAI(base_url=rag_core.VLLM_BASE, api_key="EMPTY", timeout=180)
    r = client.chat.completions.create(
        model=rag_core.LLM_MODEL, temperature=0.1,
        messages=[{"role": "user", "content": prompt}],
        extra_body=rag_core._gen_extra(),  # noqa: SLF001 — keep_alive + qwen3.5 사고 off
    )
    return r.choices[0].message.content or ""


def _parse_json(text: str) -> dict:
    """코드펜스·설명 섞임 허용 파서 — 첫 { 부터 마지막 } 까지."""
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        raise ValueError("JSON 없음")
    return json.loads(m.group(0))


def _known_items(session, models) -> list:
    """중복 방지 컨텍스트: 최근 계획 항목 제목 + 처리·중복 제보 제목."""
    known = []
    for pj in sorted(PLANS.glob("plan_*.json"))[-20:]:
        try:
            for g in json.loads(pj.read_text(encoding="utf-8")).get("groups", []):
                known.append(f"[계획] {g.get('제목', '')} — {g.get('요약', '')[:60]}")
        except Exception:  # noqa: BLE001
            continue
    Report = models["Report"]
    from sqlmodel import select  # noqa: PLC0415
    done = session.exec(select(Report).where(Report.상태.in_(["계획반영", "처리완료", "중복"]))  # type: ignore[attr-defined]
                        .order_by(Report.updated_at.desc()).limit(100)).all()
    known += [f"[처리:{r.상태}] {r.유형} {r.대상규정} {r.내용[:60]}" for r in done]
    return known[-150:]


def _send_email(summary: str, md_path: Path) -> None:
    """SMTP_URL(smtp://user:pass@host:port?to=addr) 설정 시에만 — 사내 방화벽 미개통 상태에선 no-op."""
    url = os.environ.get("SMTP_URL", "")
    if not url:
        return
    try:
        import smtplib  # noqa: PLC0415
        from email.mime.text import MIMEText  # noqa: PLC0415
        from urllib.parse import urlparse, parse_qs  # noqa: PLC0415
        u = urlparse(url)
        to = parse_qs(u.query).get("to", [u.username or ""])[0]
        msg = MIMEText(md_path.read_text(encoding="utf-8"), _charset="utf-8")
        msg["Subject"] = f"[KEI 행정 가이드] 유지보수 계획 — {summary}"
        msg["From"] = u.username or "kei-guide"
        msg["To"] = to
        with smtplib.SMTP(u.hostname, u.port or 25, timeout=10) as smtp:
            if u.username and u.password:
                smtp.starttls()
                smtp.login(u.username, u.password)
            smtp.send_message(msg)
        print(f"  이메일 발송: {to}")
    except Exception as e:  # noqa: BLE001
        print(f"  ⚠ 이메일 실패(무시): {e}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(HERE / "app.db"))
    ap.add_argument("--dry", action="store_true", help="DB 상태 변경·알림 없이 계획만 출력")
    args = ap.parse_args()

    os.environ.setdefault("APP_DB", args.db)
    sys.path.insert(0, str(HERE))
    import app_api  # noqa: PLC0415 — 모델·엔진 재사용(APP_DB 반영)
    from sqlmodel import Session, select  # noqa: PLC0415

    PLANS.mkdir(parents=True, exist_ok=True)
    now = time.time()
    stamp = datetime.datetime.fromtimestamp(now).strftime("%Y%m%d_%H%M")

    def log_run(entry: dict) -> None:
        entry = {"ts": round(now, 1), "시각": stamp, **entry}
        with RUN_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    app_api.init_db()
    with Session(app_api.engine) as s:
        new = s.exec(select(app_api.Report).where(app_api.Report.상태 == "접수")
                     .order_by(app_api.Report.created_at)).all()
        if not new:
            log_run({"result": "없음", "new": 0})
            print(f"[{stamp}] 신규 제보 없음 → run_log '없음' 기록")
            return 0

        known = _known_items(s, {"Report": app_api.Report})
        new_txt = "\n".join(f"- id={r.id}: {r.유형} / {r.대상규정} {r.대상조문} / {r.내용[:300]}"
                            for r in new)
        known_txt = "\n".join(f"- {k}" for k in known) or "- (없음)"
        rag_txt = _rag_context(new)  # 오류/누락 제보만 볼트 대조(실존/부재) — docs/51 §5
        prompt = PROMPT.format(new_reports=new_txt, rag_context=rag_txt, known_items=known_txt)

        plan = None
        for attempt in (1, 2):
            try:
                plan = _parse_json(_llm_call(prompt))
                break
            except Exception as e:  # noqa: BLE001
                print(f"  ⚠ LLM 응답 파싱 실패({attempt}/2): {e}")
        if plan is None:
            log_run({"result": "분석실패", "new": len(new)})
            return 1

        groups = plan.get("groups", []) or []
        dups = plan.get("duplicates", []) or []
        # 유효성: report_ids가 신규 집합 안에 있어야 함(환각 id 차단)
        valid_ids = {r.id for r in new}
        for g in groups:
            g["report_ids"] = [i for i in g.get("report_ids", []) if i in valid_ids]
        groups = [g for g in groups if g["report_ids"]]
        dups = [d for d in dups if d.get("report_id") in valid_ids]

        n_local = len([g for g in groups if g.get("조치구분") == "로컬조치"])
        n_code = len(groups) - n_local
        summary = f"신규 {len(new)}건 → 계획 {len(groups)}건(로컬 {n_local}·코드 {n_code})" \
                  + (f" · 중복 {len(dups)}건" if dups else "")

        # 산출물: JSON + 사람용 md
        pj = PLANS / f"plan_{stamp}.json"
        pj.write_text(json.dumps({"stamp": stamp, "groups": groups, "duplicates": dups,
                                  "new_ids": sorted(valid_ids)}, ensure_ascii=False, indent=1),
                      encoding="utf-8")
        lines = [f"# 유지보수 계획안 — {stamp}", "", f"> {summary}", ""]
        for kind, label in (("코드작업", "🛠 코드작업 (Claude Code 필요)"),
                            ("로컬조치", "🧰 로컬조치 (운영으로 해결)")):
            sel = [g for g in groups if g.get("조치구분") == kind]
            if not sel:
                continue
            lines += [f"## {label}", ""]
            for g in sel:
                rid = ", ".join(f"#{i}" for i in g["report_ids"])
                lines += [f"### {g.get('제목', '(제목 없음)')}  · 우선순위 {g.get('우선순위', '보통')} · 제보 {rid}",
                          "", g.get("요약", ""), ""]
                # LLM이 절차에 자체 번호를 붙여도 이중 번호("1. 1.")가 안 되게 벗겨낸다
                lines += [f"{i}. {re.sub(r'^\\s*\\d+[.)]\\s*', '', str(step))}"
                          for i, step in enumerate(g.get("제안절차", []), 1)]
                lines += [""]
        if dups:
            lines += ["## 중복 처리", ""]
            lines += [f"- 제보 #{d['report_id']} — {d.get('이유', '')}" for d in dups]
        md = PLANS / f"plan_{stamp}.md"
        md.write_text("\n".join(lines), encoding="utf-8")
        print(f"[{stamp}] {summary} → {md.name}")

        if args.dry:
            print("  (--dry: DB·알림 미반영)")
            return 0

        # DB 반영: 상태·analysis_group (⛔ 볼트·검수상태 불변)
        for gi, g in enumerate(groups, 1):
            for rid2 in g["report_ids"]:
                r = s.get(app_api.Report, rid2)
                if r and r.상태 == "접수":
                    r.상태 = "분석됨"
                    r.analysis_group = f"plan_{stamp}#g{gi}"
                    r.updated_at = time.time()
                    s.add(r)
        for d in dups:
            r = s.get(app_api.Report, d["report_id"])
            if r and r.상태 == "접수":
                r.상태 = "중복"
                r.analysis_group = f"plan_{stamp}#dup"
                r.admin_note = (r.admin_note + f"\n[자동] 중복: {d.get('이유', '')}").strip()
                r.updated_at = time.time()
                s.add(r)
        if groups:
            s.add(app_api.MaintNotice(kind="plan", summary=summary,
                                      detail_path=str(md.relative_to(HERE))))
        s.commit()
        log_run({"result": "계획", "new": len(new), "groups": len(groups),
                 "dups": len(dups), "plan": md.name})
        if groups:
            _send_email(summary, md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
