---
name: setup
description: Fork-local development setup and isolation boundaries.
triggers:
  - setup
  - install
  - environment
  - local development
edges:
  - target: context/architecture.md
    condition: when understanding the shared catalog and runtime hosts
grounds_to: []
last_updated: 2026-11-12
---

# Setup

## Prerequisites

- Python 3.9+ for the catalog router.
- Node.js 22.20+ and `npx` for selected skill installation.
- Bash for `scripts/jeo-local.sh`.
- Optional: the fork-owned `jev-droid` CLI installed on PATH, with configured local System One models. This dependency is only needed for `systemone` commands.

## Fork-local workflow

From the existing fork checkout:

```bash
cd ~/tools/jeo-skills
./scripts/jeo-local.sh doctor
./scripts/jeo-local.sh categories
./scripts/jeo-local.sh search "react performance"
./scripts/jeo-local.sh install jeo-skill --dry-run
./scripts/jeo-local.sh install jeo-skill --yes
./scripts/test-jeo-local.sh
./scripts/jeo-local.sh systemone models
./scripts/jeo-local.sh systemone route julia "Review architecture"
```

- Source catalog: `.agent-skills/skills.json` and `.agent-skills/<name>/SKILL.md`.
- Installed selections: checkout-local `.jeo-local/.agents/skills/<name>/` (ignored by Git).
- The local launcher fixes both source and destination to this checkout, regardless of the caller's working directory.
- It rejects global installation, explicit host targeting, setup/hooks, linking, and lifecycle cleanup.
- Do **not** use root `install.sh`, `scripts/skills-upgrade.sh`, or `jeo-skill link` for this sandbox; those workflows may write host/global paths.
- Only selected skills get copied locally. No runtime outside this checkout is configured to load them.
- `systemone route` uses the existing `jev-droid` model registry and runtime, with a checkout-isolated Jev environment and Jeo's catalog; it never enables global hooks or Jev profiles.
- For slow managed models, the shared Droid configuration uses a 300-second idle window; a server started by the isolated wrapper is stopped immediately after the command.

## Verification

```bash
./scripts/test-jeo-local.sh
shellcheck scripts/jeo-local.sh scripts/test-jeo-local.sh
python3 scripts/validate-catalog-projections.py
test -f .jeo-local/.agents/skills/jeo-skill/SKILL.md
git diff --check
```

If `repowise status` reports no index, fall back to the repository source and tests; do not initialize it without approval.
