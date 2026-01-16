#!/bin/bash
set -euo pipefail
echo "=== chittysync Onboarding ==="
curl -s -X POST "${GETCHITTY_ENDPOINT:-https://get.chitty.cc/api/onboard}" \
  -H "Content-Type: application/json" \
  -d '{"service_name":"chittysync","organization":"CHITTYOS","type":"service","tier":3,"domains":["sync.chitty.cc"]}' | jq .
