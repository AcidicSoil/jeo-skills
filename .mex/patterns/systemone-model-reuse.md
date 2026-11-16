---
name: systemone-model-reuse
description: Reuse installed System One decision models in the isolated Jeo catalog without configuring global skills.
last_updated: 2026-11-16
---

# Fork-local System One model reuse

## Steps

1. Check the installed `jev-droid` runtime and models without starting them:
   `./scripts/jeo-systemone.sh models` (table) or
   `./scripts/jeo-local.sh systemone models` (JSON).
2. Run `./scripts/jeo-systemone.sh config sync` to populate
   `~/.config/jeo-skills/systemone.json` with configured Droid profiles.
   Edit global `model`, `store`, `format`, `routing`, `systemOne`, or
   per-model `profiles` settings as needed; the local
   `scripts/jeo-systemone.config.json` is a field-level overlay (null inherits).
   Relative stores resolve beside their config. Run
   `./scripts/jeo-systemone.sh "Review architecture"` with these defaults,
   or specify `julia` before the task to override the model.
3. The wrapper uses the actual Droid registry and served model identity, then
   runs `jev/jev-harness.mjs` against the selected skills catalog. The
   `gateThreshold` and `fitThreshold` drive harness filtering; `topK`,
   `choiceCap`, `maxStateChars`, and timeouts are bounded by their actual
   code contracts. `--store <path>` overrides the catalog per request.
   For the shared installed root, run `scripts/sync-skill-store.sh`
   after installed skills change, or pass another store path to that script.
   Sync uses only Node.js and a bounded SKILL.md metadata parser; no PyYAML.
   Then use `--store ~/.agents/skills`. The original `jeo-local.sh systemone route`
   continues to emit JSON without reading wrapper preferences.
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
