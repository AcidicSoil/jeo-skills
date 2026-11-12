#!/usr/bin/env bash
# Use this fork's catalog and an ignored local sandbox; never modify host roots.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
workspace="$repo/.jeo-local"
cli="$repo/.agent-skills/jeo-skill/scripts/jeo-skill.py"
export JEO_SKILLS_CATALOG="$repo/.agent-skills/skills.json"

die() { printf 'jeo-local: %s\n' "$*" >&2; exit 2; }

if [[ $# -eq 0 ]]; then
  set -- --help
fi

case "$1" in
  categories|list|search|related|doctor|-h|--help) ;;
  systemone)
    shift
    cd "$repo"
    exec node "$repo/scripts/jeo-systemone.mjs" "$@"
    ;;
  install)
    for arg in "$@"; do
      case "$arg" in
        -g|--global|--global=*|-g?*|--setup|--setup=*|--with-hooks|--with-hooks=*|\
        -a|--agent|--agent=*|-a?*|--source|--source=*|--aside-home|--aside-home=*|\
        --aside-account|--aside-account=*)
          die "Option '$arg' is disabled for the isolated checkout"
          ;;
      esac
    done
    if [[ -L "$workspace" || -L "$workspace/.agents" || -L "$workspace/.agents/skills" ]]; then
      die "Refusing a symlinked isolated skill destination"
    fi
    mkdir -p "$workspace"
    set -- "$@" --source "$repo" --agent universal
    ;;
  *)
    die "Command '$1' is unavailable in isolated mode"
    ;;
esac

if [[ "$1" == install ]]; then
  cd "$workspace"
else
  cd "$repo"
fi
exec python3 "$cli" "$@"
