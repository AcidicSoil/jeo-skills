#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
runner="$repo/scripts/jeo-local.sh"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
reject() {
  if bash "$runner" "$@" >/dev/null 2>&1; then
    fail "Allowed an unsafe command: $*"
  fi
}

# Even from another directory, selections must stay in this checkout.
lock_before="$(sha256sum "$repo/skills-lock.json")"
preview="$(cd /tmp && bash "$runner" install code-review --dry-run)"
[[ "$(sha256sum "$repo/skills-lock.json")" == "$lock_before" ]] ||
  fail "Dry run modified the tracked catalog lockfile"
git -C "$repo" check-ignore -q .jeo-local/skills-lock.json ||
  fail "Isolated state is not gitignored"
[[ "$preview" == *"add $repo"* ]] || fail "Installer did not use the fork checkout"
[[ "$preview" == *"Destination: $repo/.jeo-local/.agents/skills"* ]] ||
  fail "Installer did not target the isolated workspace"
[[ "$preview" == *"--agent universal"* ]] || fail "Installer did not select project-local skill root"
[[ "$preview" != *"--global"* ]] || fail "Installer unexpectedly targets global skills"

(cd /tmp && bash "$runner" search "code review") | grep -q 'code-review' ||
  fail "Repository catalog search is unavailable"
reject install code-review --global --dry-run
reject install code-review -g --dry-run
reject install code-review --setup --dry-run
reject install code-review --with-hooks --dry-run
reject install code-review --agent claude-code --dry-run
reject install code-review --source https://github.com/other/repo --dry-run
reject link
reject prune-retired
node --test "$repo/scripts/test-jeo-systemone.mjs"
printf 'PASS: local router and isolation guards\n'
