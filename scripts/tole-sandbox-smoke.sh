#!/usr/bin/env bash
# Tole sandbox smoke test for the Kaspi INVOICE flow (no real money).
# Usage:
#   TOLE_API_KEY=tole_sk_test_... TOLE_CONNECTION_ID=<uuid> TOLE_TEST_PHONE=+77001234567 bash scripts/tole-sandbox-smoke.sh
# Prints only HTTP codes and Tole ids — never the key, the phone or raw payloads.
set -euo pipefail
: "${TOLE_API_KEY:?set TOLE_API_KEY (tole_sk_test_...)}"
: "${TOLE_CONNECTION_ID:?set TOLE_CONNECTION_ID}"
: "${TOLE_TEST_PHONE:?set TOLE_TEST_PHONE (+7XXXXXXXXXX)}"
BASE="${TOLE_API_BASE_URL:-https://api.tolepay.kz/v1}"
case "$TOLE_API_KEY" in tole_sk_test_*) ;; *) echo "refusing: not a test key"; exit 1;; esac
KEY="smoke-$(date +%Y%m%d%H%M%S)"
H=(-H "Authorization: Bearer $TOLE_API_KEY" -H "X-Tole-Connection-Id: $TOLE_CONNECTION_ID" -H "Content-Type: application/json")
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s||"{}");const v=process.argv[1].split(".").reduce((a,k)=>a?.[k],o);console.log(v??"")})' "$1"; }

echo "1) POST /sandbox/invoices (Idempotency-Key: $KEY)"
R=$(curl -sS --max-time 20 -w '\n%{http_code}' "${H[@]}" -H "Idempotency-Key: $KEY" \
  -d "{\"phoneNumber\":\"$TOLE_TEST_PHONE\",\"amount\":100,\"comment\":\"TrendMe smoke\"}" "$BASE/sandbox/invoices")
CODE=$(tail -n1 <<<"$R"); BODY=$(sed '$d' <<<"$R")
ID=$(field data.id <<<"$BODY"); CMD=$(field commandId <<<"$BODY")
echo "   http=$CODE id=$ID commandId=$CMD kind=$(field kind <<<"$BODY")"

echo "2) replay with the SAME key → must return the same id (idempotency)"
R2=$(curl -sS --max-time 20 "${H[@]}" -H "Idempotency-Key: $KEY" \
  -d "{\"phoneNumber\":\"$TOLE_TEST_PHONE\",\"amount\":100,\"comment\":\"TrendMe smoke\"}" "$BASE/sandbox/invoices")
echo "   id=$(field data.id <<<"$R2") replayed=$(field replayed <<<"$R2")"

if [ -n "$CMD" ]; then
  echo "3) GET /sandbox/commands/$CMD"
  echo "   status=$(curl -sS --max-time 20 "${H[@]}" "$BASE/sandbox/commands/$CMD" | field data.status)"
fi
if [ -n "$ID" ]; then
  echo "4) POST /sandbox/payment-intents/$ID/simulate {status: paid} → Tole sends payment.paid webhook"
  echo "   http=$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "${H[@]}" -d '{"status":"paid"}' "$BASE/sandbox/payment-intents/$ID/simulate")"
fi
