#!/usr/bin/env bash
# Integration tests for SQL (migrations + payment state machine, queue, RLS, account deletion).
# Uses $TEST_DATABASE_URL if set; otherwise starts a throwaway local Postgres (needs initdb/pg_ctl).
# NEVER point TEST_DATABASE_URL at production: the tests create and delete data.
set -euo pipefail
cd "$(dirname "$0")/.."
cleanup() { [[ -n "${PGDIR:-}" ]] && pg_ctl -D "$PGDIR/data" stop -m fast >/dev/null 2>&1 || true; }
trap cleanup EXIT

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1); export PATH="$BIN:$PATH"
  PGDIR=$(mktemp -d); initdb -D "$PGDIR/data" -A trust -U postgres >/dev/null
  pg_ctl -D "$PGDIR/data" -o "-p 54329 -k $PGDIR" -l "$PGDIR/log" start >/dev/null; sleep 2
  TEST_DATABASE_URL="postgresql://postgres@localhost:54329/postgres?host=$PGDIR"
fi
PSQL=(psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -t -A)
"${PSQL[@]}" -f supabase/tests/00_stubs.sql
# Supabase-only extensions (pg_cron, pg_net) are stubbed above; skip their install lines.
for f in supabase/migrations/*.sql; do
  grep -vE '^create extension if not exists (pg_cron|pg_net);' "$f" | "${PSQL[@]}" >/dev/null
done
echo "migrations: ok ($(ls supabase/migrations/*.sql | wc -l))"
for f in supabase/tests/[1-9]*.sql; do echo "== $f"; "${PSQL[@]}" -f "$f" 2>&1 | sed -e "s/.*NOTICE:  //" -e "/^CONTEXT\|^PL\/pgSQL\|^SQL statement/d"; done
echo "db tests: PASS"
