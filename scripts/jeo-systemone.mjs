#!/usr/bin/env node
// Fork-local adapter: reuse Droid's model runtimes, not its skill catalog.
import { spawn, execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { modelsTable, skillsTable } from './jeo-systemone-table.mjs';
import { forProfile, preferences, syncGlobalProfiles } from './jeo-systemone-settings.mjs';
import { join, resolve, basename } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const execFileAsync = promisify(execFile);
const repo = resolve(import.meta.dirname, '..');
const droid = process.env.JEO_SYSTEMONE_DROID_BIN || 'jev-droid';
const catalog = join(repo, '.agent-skills', 'skills.json');
const harness = join(repo, 'jev', 'jev-harness.mjs');
const workspace = join(repo, '.jeo-local');

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

function isolatedHarnessEnv(endpoint, model, catalogPath, settings) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('JEV_')) delete env[key];
  return {
    ...env, HOME: join(workspace, 'home'), XDG_STATE_HOME: join(workspace, 'state'),
    JEV_MODE: 'systemone',
    JEV_CATALOG_PATH: catalogPath,
    JEV_SYSTEMONE_DRIVER: 'typesafe',
    JEV_SYSTEMONE_ENDPOINT: endpoint + '/v1/systemone',
    JEV_SYSTEMONE_MODEL: model,
    JEV_SYSTEMONE_CHOICE_CAP: String(settings.choiceCap),
    JEV_SYSTEMONE_MAX_STATE_CHARS: String(settings.maxStateChars),
    JEV_SYSTEMONE_TIMEOUT_MS: String(settings.inferenceTimeoutMs),
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

function startupTimeout(fallback) {
  const value = Number(process.env.JEO_SYSTEMONE_STARTUP_TIMEOUT_MS || fallback);
  if (!Number.isInteger(value) || value < 1000 || value > 600000) {
    throw new Error('Invalid System One startup timeout');
  }
  return value;
}

async function waitForModel(profile, owned, timeoutMs) {
  const deadline = Date.now() + startupTimeout(timeoutMs);
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

async function catalogForStore(store) {
  if (!store) return catalog;
  const target = resolve(store);
  let candidates = [target];
  try {
    if ((await stat(target)).isDirectory()) {
      candidates = [join(target, 'skills.json'), join(target, '.agent-skills', 'skills.json')];
    }
  } catch { /* The chosen store does not exist. */ }
  for (const file of candidates) {
    try { if ((await stat(file)).isFile()) return file; }
    catch { /* Try the next supported catalog location. */ }
  }
  throw new Error('Skills store must contain a readable skills.json catalog: ' + target);
}

async function route(name, task, { store, table, routing, systemOne } = {}) {
  if (!task.trim()) throw new Error('route requires a task description');
  const catalogPath = await catalogForStore(store);
  const selected = (await profiles()).find(profile => profile.name === name);
  if (!selected) throw new Error('Unknown System One profile: ' + name);
  const endpoint = loopback(selected.endpoint);
  if (selected.modelPresent === false) throw new Error('Configured model file is missing');
  let child = null;
  try {
    let model = await runningModel(selected);
    if (!model) {
      child = startOwned(selected);
      model = await waitForModel(selected, child, systemOne.startupTimeoutMs);
    }
    await mkdir(workspace, { recursive: true });
    const { stdout } = await execFileAsync(process.execPath,
      [harness, 'route-skills', '--top-k', String(routing.topK),
        '--gate-threshold', String(routing.gateThreshold),
        '--fit-threshold', String(routing.fitThreshold), task], {
        cwd: repo,
        env: isolatedHarnessEnv(endpoint, model, catalogPath, systemOne),
        timeout: 600000,
        maxBuffer: 5 * 1024 * 1024,
      });
    process.stdout.write(table ? skillsTable(JSON.parse(stdout)) : stdout);
  } finally {
    await stopOwned(child?.child);
  }
}

function parseOptions(args) {
  const options = { args, table: false };
  while (['--table', '--store', '--config'].includes(args[0])) {
    const flag = args.shift();
    if (flag === '--table') {
      options.table = true;
      continue;
    }
    const value = args.shift();
    if (!value) throw new Error(flag + ' requires a path');
    if (flag === '--store') options.store = value;
    else options.configPath = value;
  }
  return options;
}

function routingRequest(args, defaultModel) {
  const parts = args[0] === 'route' ? args.slice(1) : args;
  const model = parts.length > 1 ? parts[0] : defaultModel;
  const task = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
  if (!model || !task) {
    throw new Error('Usage: jeo-systemone.sh [--store PATH] [MODEL] "task"');
  }
  return { model, task };
}

async function printModels(table) {
  const found = await profiles();
  process.stdout.write(table ? modelsTable(found) : JSON.stringify({ profiles: found }) + '\n');
}

async function syncModels() {
  const discovered = (await profiles()).map(profile => profile.name);
  await syncGlobalProfiles(discovered);
  process.stdout.write('Discovered System One profiles: ' + discovered.join(', ') + '\n');
}

function tableOutput(options, settings) {
  return options.table || (settings.format ?? (options.configPath ? 'table' : 'json')) === 'table';
}

async function main(input) {
  const options = parseOptions(input);
  const settings = options.configPath ? await preferences(options.configPath) : {};
  if (options.args.join(' ') === 'config sync') return syncModels();
  const table = tableOutput(options, settings);
  if (options.args.length === 1 && options.args[0] === 'models') return printModels(table);
  const { model, task } = routingRequest(options.args, settings.model);
  const selected = forProfile(settings, model);
  return route(model, task, {
    store: options.store ?? selected.store, table,
    routing: selected.routing, systemOne: selected.systemOne,
  });
}

main(process.argv.slice(2)).catch(error => {
  console.error('jeo-systemone: ' + error.message);
  process.exitCode = 2;
});
