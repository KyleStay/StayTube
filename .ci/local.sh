#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 .ci/check-no-hosted-ci.py
if [[ "${1:-}" == "--check" ]]; then
  bash -n "$0"
  exit 0
fi
mkdir -p .ci/logs
ci_log=".ci/logs/$(date -u +%Y%m%dT%H%M%SZ)-$$.log"
ci_result=0
sh scripts/build-store-package.sh > "$ci_log" 2>&1 || ci_result=$?
cat "$ci_log"
printf 'Local CI exit=%s; log=%s\n' "$ci_result" "$ci_log"
exit "$ci_result"
