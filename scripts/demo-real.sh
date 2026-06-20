#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${EVOMAP_API_KEY:-}" ]]; then
  echo "missing EVOMAP_API_KEY. Run: export EVOMAP_API_KEY=\"sk-evomap-...\"" >&2
  exit 1
fi

export DRIFT_PUBLISH="${DRIFT_PUBLISH:-1}"
export DRIFT_DAEMON="${DRIFT_DAEMON:-0}"
export DRIFT_CONFIG="${DRIFT_CONFIG:-config.evomap.yaml}"
export DRIFT_DB="${DRIFT_DB:-data/driftsentinel-real.db}"
export PORT="${PORT:-8794}"

pnpm build
exec pnpm --filter @driftsentinel/server start
