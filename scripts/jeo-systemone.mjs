#!/usr/bin/env node
// Fork-local adapter: reuse Droid's model runtimes, not its skill catalog.
import { spawn, execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const execFileAsync = promisify(execFile);
const repo = resolve(import.meta.dirname, '..');
const droid = process.env.JEO_SYSTEMONE_DROID_BIN || 'jev-droid';
const catalog = join(repo, '.agent-skills', 'skills.json');
const harness = join(repo, 'jev', 'jev-harness.mjs');
const workspace = join(repo, '.jeo-local');
const STARTUP_MS = 360000;
const LIMITS = { choiceCap: 16, stateChars: 3000, inferenceMs: 120000 };

function loopback(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('Model endpoint must be HTTP loopback'); }
  const valid = [
    url.protocol === 'http:',
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
    Boolean(url.port),
    url.pathname === '/',
    !url.username, !url.password, !url.search, !url.hash,
  ].every(Boolean);
  if (!valid) throw new Error('Model endpoint must be HTTP loopback');
  return url.origin;
}

async function profiles() {
  const { stdout } = await execFileAsync(droid, ['models'], { timeout: 10000, maxBuffer: 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed?.profiles)) throw new Error('Droid model registry is invalid');
  return parsed.profiles;
}

async function requestJson(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'error' });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

function servedId(health, models) {
  if (typeof health?.model === 'string' && health.model) return health.model;
  const ids = models?.data?.map(entry => entry?.id).filter(id => typeof id === 'string' && id);
  return ids?.length === 1 ? ids[0] : null;
}

function requireSelectedModel(profile, id) {
  if (!id) throw new Error('Model is running but did not provide an unambiguous identity');
  if (profile.model && profile.modelPresent === null && id !== profile.model) {
    throw new Error('Running System One model does not match the selected Droid profile');
  }
  if (profile.runtime === 'native' && basename(id) !== profile.model) {
    throw new Error('Running GGUF does not match the selected Droid profile');
  }
  return id;
}

async function runningModel(profile) {
  const endpoint = loopback(profile.endpoint);
  const health = await requestJson(endpoint + '/health');
  if (health?.status !== 'ok') return null;
  const models = health.model ? null : await requestJson(endpoint + '/v1/models');
  return requireSelectedModel(profile, servedId(health, models));
}

function isolatedHarnessEnv(endpoint, model) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('JEV_')) delete env[key];
  return {
    ...env, HOME: join(workspace, 'home'), XDG_STATE_HOME: join(workspace, 'state'),
    JEV_MODE: 'systemone',
    JEV_CATALOG_PATH: catalog,
    JEV_SYSTEMONE_DRIVER: 'typesafe',
    JEV_SYSTEMONE_ENDPOINT: endpoint + '/v1/systemone',
    JEV_SYSTEMONE_MODEL: model,
    JEV_SYSTEMONE_CHOICE_CAP: String(LIMITS.choiceCap),
    JEV_SYSTEMONE_MAX_STATE_CHARS: String(LIMITS.stateChars),
    JEV_SYSTEMONE_TIMEOUT_MS: String(LIMITS.inferenceMs),
  };
}

async function stopOwned(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const timer = new AbortController();
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(done => child.once('exit', done)),
    sleep(8000, undefined, { signal: timer.signal }).catch(() => {}),
  ]);
  timer.abort();
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

function startOwned(profile) {
  const child = spawn(droid, ['--model', profile.name, 'serve'], {
    stdio: ['ignore', 'ignore', 'pipe'], env: process.env,
  });
  let detail = '';
  child.stderr.on('data', chunk => { detail = (detail + chunk).slice(-1200); });
  child.on('error', error => { detail = error.message; });
  return { child, diagnostic: () => detail.trim() };
}

function startupTimeout() {
  const value = Number(process.env.JEO_SYSTEMONE_STARTUP_TIMEOUT_MS || STARTUP_MS);
  if (!Number.isInteger(value) || value < 1000 || value > 600000) {
    throw new Error('Invalid System One startup timeout');
  }
  return value;
}

async function waitForModel(profile, owned) {
  const deadline = Date.now() + startupTimeout();
  while (Date.now() < deadline) {
    if (owned.child.exitCode !== null || owned.child.signalCode !== null) {
      throw new Error('Droid model server exited before becoming ready: ' +
        (owned.diagnostic() || 'see the Droid runtime logs'));
    }
    const model = await runningModel(profile);
    if (model) return model;
    await sleep(500);
  }
  throw new Error('Droid model startup exceeded its deadline');
}

async function route(name, task) {
  if (!task.trim()) throw new Error('route requires a task description');
  const selected = (await profiles()).find(profile => profile.name === name);
  if (!selected) throw new Error('Unknown System One profile: ' + name);
  const endpoint = loopback(selected.endpoint);
  if (selected.modelPresent === false) throw new Error('Configured model file is missing');
  let child = null;
  try {
    let model = await runningModel(selected);
    if (!model) {
      child = startOwned(selected);
      model = await waitForModel(selected, child);
    }
    await mkdir(workspace, { recursive: true });
    const { stdout } = await execFileAsync(process.execPath,
      [harness, 'route-skills', task], {
        cwd: repo,
        env: isolatedHarnessEnv(endpoint, model),
        timeout: 600000,
        maxBuffer: 5 * 1024 * 1024,
      });
    process.stdout.write(stdout);
  } finally {
    await stopOwned(child?.child);
  }
}

async function main(args) {
  if (args.length === 1 && args[0] === 'models') {
    process.stdout.write(JSON.stringify({ profiles: await profiles() }) + '\n');
    return;
  }
  if (args[0] === 'route' && args.length >= 3) {
    await route(args[1], args.slice(2).join(' '));
    return;
  }
  throw new Error('Usage: jeo-local.sh systemone models | systemone route MODEL "task"');
}

main(process.argv.slice(2)).catch(error => {
  console.error('jeo-systemone: ' + error.message);
  process.exitCode = 2;
});
