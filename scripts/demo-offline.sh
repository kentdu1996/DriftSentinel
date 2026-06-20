#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export DRIFT_DAEMON="${DRIFT_DAEMON:-0}"
export DRIFT_CONFIG="${DRIFT_CONFIG:-config.demo.yaml}"
export DRIFT_DB="${DRIFT_DB:-data/driftsentinel-demo.db}"
export PORT="${PORT:-8787}"

pnpm build
exec pnpm --filter @driftsentinel/server start
