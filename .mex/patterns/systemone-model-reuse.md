---
name: systemone-model-reuse
description: Reuse installed System One decision models in the isolated Jeo catalog without configuring global skills.
last_updated: 2026-11-13
---

# Fork-local System One model reuse

## Steps

1. Check the installed `jev-droid` runtime and models without starting them:
   `./scripts/jeo-systemone.sh models` (table) or
   `./scripts/jeo-local.sh systemone models` (JSON).
2. Select an existing profile by name; do **not** copy models or enable hooks:
   `./scripts/jeo-systemone.sh julia "Review architecture"` (table) or
   `./scripts/jeo-local.sh systemone route julia "Review architecture"` (JSON).
3. The wrapper uses the model registry and actual served identity, then runs
   `jev/jev-harness.mjs` against `.agent-skills/skills.json` in a checkout-only environment.
   An optional `--store <path>` before the model selects another existing
   `skills.json` catalog for the request only; it never installs those skills.
4. If the wrapper started the model, it stops it. An already-running model stays running.
   No `~/.agents/skills` writes or global Jev profiles are permitted.
5. Test with `scripts/test-jeo-local.sh`, plus targeted real inference for a changed runtime.

## Diagnostics

- `Unknown System One profile`: check Droid's canonical registry, not a Jeo model copy.
- `Droid model server exited before becoming ready`: inspect the owning runtime logs;
  slow managed cold starts need an idle window longer than loading time.
- `input ... exceeds physical batch size`: update and test the selected model's
  supported physical batching in Droid's canonical configuration; never truncate silently.
- `unvalidated`: transport and routing worked; no calibration/authorization was proven.
- A remote endpoint or mismatched served model fails closed. No LM Studio is required.
