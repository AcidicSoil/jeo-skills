#!/usr/bin/env bash
# Refresh a skill store's routing catalog without changing installed skills.
set -euo pipefail

repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
if (( $# > 1 )); then
  echo "Usage: sync-skill-store.sh [SKILLS_DIRECTORY]" >&2
  exit 2
fi

store="${1:-$HOME/.agents/skills}"
exec node "$repo/scripts/index-installed-skills.mjs" "$store"
