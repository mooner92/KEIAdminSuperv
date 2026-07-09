#!/usr/bin/env python3
"""user_admin.py — 계정 운영 CLI (v1 스펙 B5: 비밀번호 분실 대응 경로).

셀프서비스 리셋(이메일 등) 없는 온프레미스 환경에서, 관리자가 서버에서 직접 처리한다.
해시는 app_api.hash_pw와 동일(bcrypt, 72바이트 절단) — 웹 로그인과 완전 호환.

사용:
  APP_DB=tools/app.db python tools/user_admin.py list
  APP_DB=tools/app.db python tools/user_admin.py reset-pw <username> [--password <새비밀번호>]
  APP_DB=tools/app.db python tools/user_admin.py delete <username> --yes   (채팅·피드백 함께 삭제)

- APP_DB 미지정 시 이 파일 옆 app.db.
- reset-pw에 --password가 없으면 안전한 임시 비밀번호를 생성해 출력한다(1회 전달용).
⛔ 이 CLI는 검수상태·규정 데이터와 무관 — 사용자 계정만 다룬다.
"""
import argparse
import os
import secrets
import sqlite3
import sys
import time

import bcrypt

DB_PATH = os.environ.get("APP_DB", os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.db"))


def hash_pw(pw: str) -> str:  # app_api.hash_pw와 동일 규칙
    return bcrypt.hashpw(pw.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")


def _conn():
    if not os.path.exists(DB_PATH):
        sys.exit(f"⛔ app.db 없음: {DB_PATH} (APP_DB 환경변수 확인)")
    return sqlite3.connect(DB_PATH)


def cmd_list(_args):
    c = _conn()
    rows = c.execute(
        "SELECT u.id, u.username, u.created_at,"
        " (SELECT COUNT(*) FROM chatsession s WHERE s.user_id=u.id) AS chats"
        " FROM user u ORDER BY u.id"
    ).fetchall()
    print(f"{'id':>4}  {'username':<20} {'가입일':<12} 대화수   (DB: {DB_PATH})")
    for i, name, ts, chats in rows:
        day = time.strftime("%Y-%m-%d", time.localtime(ts)) if ts else "-"
        print(f"{i:>4}  {name:<20} {day:<12} {chats}")
    c.close()


def cmd_reset_pw(args):
    c = _conn()
    row = c.execute("SELECT id FROM user WHERE username=?", (args.username,)).fetchone()
    if not row:
        sys.exit(f"⛔ 사용자 없음: {args.username}")
    pw = args.password or secrets.token_urlsafe(9)  # 임시 비밀번호(~12자)
    c.execute("UPDATE user SET password_hash=? WHERE id=?", (hash_pw(pw), row[0]))
    c.commit(); c.close()
    print(f"✅ {args.username} 비밀번호 재설정 완료")
    if not args.password:
        print(f"   임시 비밀번호: {pw}   (사용자에게 1회 전달 후 즉시 변경 권장)")


def cmd_delete(args):
    if not args.yes:
        sys.exit("⛔ 파괴적 작업 — --yes 필요 (채팅·피드백 함께 삭제됨)")
    c = _conn()
    row = c.execute("SELECT id FROM user WHERE username=?", (args.username,)).fetchone()
    if not row:
        sys.exit(f"⛔ 사용자 없음: {args.username}")
    uid = row[0]
    n_msg = c.execute(
        "SELECT COUNT(*) FROM message WHERE session_id IN (SELECT id FROM chatsession WHERE user_id=?)", (uid,)
    ).fetchone()[0]
    c.execute("DELETE FROM feedback WHERE user_id=?", (uid,))
    c.execute("DELETE FROM message WHERE session_id IN (SELECT id FROM chatsession WHERE user_id=?)", (uid,))
    c.execute("DELETE FROM chatsession WHERE user_id=?", (uid,))
    c.execute("DELETE FROM user WHERE id=?", (uid,))
    c.commit(); c.close()
    print(f"✅ {args.username} 삭제 (메시지 {n_msg}건 포함)")


def main():
    ap = argparse.ArgumentParser(description="KEI 행정 LLM 계정 운영 CLI")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="사용자 목록")
    r = sub.add_parser("reset-pw", help="비밀번호 재설정(미지정 시 임시 비밀번호 생성)")
    r.add_argument("username")
    r.add_argument("--password", help="직접 지정(미지정 시 임시 생성)")
    d = sub.add_parser("delete", help="계정 삭제(채팅·피드백 포함)")
    d.add_argument("username")
    d.add_argument("--yes", action="store_true")
    args = ap.parse_args()
    {"list": cmd_list, "reset-pw": cmd_reset_pw, "delete": cmd_delete}[args.cmd](args)


if __name__ == "__main__":
    main()
