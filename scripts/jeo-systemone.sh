#!/usr/bin/env bash
# Convenience entry point for Jeo's fork-local System One router.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
exec node "$repo/scripts/jeo-systemone.mjs" --config "$repo/scripts/jeo-systemone.config.json" "$@"
