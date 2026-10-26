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
exec > >(tee "$ci_log") 2>&1
trap 'result=$?; echo "Local CI exit=$result; log=$ci_log"; exit "$result"' EXIT
sh scripts/build-store-package.sh
