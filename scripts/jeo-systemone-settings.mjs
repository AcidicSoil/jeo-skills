import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { GATE_THRESHOLD, FITS_THRESHOLD, DEFAULT_TOP_K } from '../jev/route-defaults.mjs';

export const DEFAULT_ROUTING = { gateThreshold: GATE_THRESHOLD, fitThreshold: FITS_THRESHOLD, topK: DEFAULT_TOP_K };
export const DEFAULT_SYSTEM_ONE = {
  choiceCap: 16, maxStateChars: 3000, inferenceTimeoutMs: 120000, startupTimeoutMs: 360000,
};
const RANGES = {
  gateThreshold: [0, 1], fitThreshold: [0, 1], topK: [1, 50],
  choiceCap: [2, 255], maxStateChars: [1024, 100000],
  inferenceTimeoutMs: [1000, 300000], startupTimeoutMs: [1000, 600000],
};
const INTEGERS = new Set(['topK', 'choiceCap', 'maxStateChars', 'inferenceTimeoutMs', 'startupTimeoutMs']);

export function globalConfigPath() {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'jeo-skills', 'systemone.json');
}

function object(value, label) {
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    throw new Error('Invalid System One config property: ' + label);
  }
  return value;
}

function validRange(key, entry) {
  const [min, max] = RANGES[key];
  return typeof entry === 'number' && Number.isFinite(entry) && entry >= min &&
    entry <= max && (!INTEGERS.has(key) || Number.isInteger(entry));
}

function fields(value, names, label) {
  for (const [key, entry] of Object.entries(value)) {
    if (!names.includes(key)) throw new Error('Unknown System One config property: ' + label + key);
    if (entry != null && key in RANGES && !validRange(key, entry)) {
      throw new Error('Invalid System One config property: ' + label + key);
    }
  }
}

function validateSection(config, label) {
  for (const [name, allowed] of [['routing', Object.keys(DEFAULT_ROUTING)], ['systemOne', Object.keys(DEFAULT_SYSTEM_ONE)]]) {
    if (config[name] == null) continue;
    const section = object(config[name], label + name);
    fields(section, allowed, label + name + '.');
  }
}

function validateConfig(data) {
  const config = object(data, 'root');
  fields(config, ['model', 'store', 'format', 'routing', 'systemOne', 'profiles'], '');
  const invalid = ['model', 'store'].find(key =>
    config[key] != null && (typeof config[key] !== 'string' || !config[key].trim()));
  if (invalid) throw new Error('Invalid System One config property: ' + invalid);
  if (config.format != null && !['table', 'json'].includes(config.format)) {
    throw new Error('Invalid System One config property: format');
  }
  validateSection(config, '');
  if (config.profiles != null) {
    for (const [name, settings] of Object.entries(object(config.profiles, 'profiles'))) {
      const profile = object(settings, 'profiles.' + name);
      fields(profile, ['routing', 'systemOne'], 'profiles.' + name + '.');
      validateSection(profile, 'profiles.' + name + '.');
    }
  }
  return config;
}

export async function readConfig(file, optional = false, resolveStore = true) {
  if (!file) return {};
  let source;
  try { source = await readFile(file, 'utf8'); }
  catch (error) {
    if (optional && error.code === 'ENOENT') return {};
    throw new Error('Cannot read System One config ' + file + ': ' + error.message);
  }
  let config;
  try { config = validateConfig(JSON.parse(source)); }
  catch (error) { throw new Error('Cannot parse System One config ' + file + ': ' + error.message); }
  return resolveStore && config.store
    ? { ...config, store: resolve(dirname(file), config.store) }
    : config;
}

function enabledEntries(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null));
}

function mergeSections(a = {}, b = {}) {
  return { ...enabledEntries(a), ...enabledEntries(b) };
}

function mergeProfile(left = {}, right = {}) {
  return {
    routing: mergeSections(left.routing, right.routing),
    systemOne: mergeSections(left.systemOne, right.systemOne),
  };
}

export function mergePreferences(left, right) {
  const merged = { ...enabledEntries(left), ...enabledEntries(right) };
  Object.assign(merged, mergeProfile(left, right));
  const names = new Set([...Object.keys(left.profiles || {}), ...Object.keys(right.profiles || {})]);
  merged.profiles = Object.fromEntries([...names].map(name => [
    name, mergeProfile(left.profiles?.[name], right.profiles?.[name]),
  ]));
  return merged;
}

export async function preferences(configPath) {
  const global = await readConfig(globalConfigPath(), true);
  if (!configPath) return global;
  return mergePreferences(global, await readConfig(resolve(configPath)));
}

export function forProfile(settings, name) {
  const profile = settings.profiles?.[name] || {};
  return {
    ...settings,
    routing: { ...DEFAULT_ROUTING, ...settings.routing, ...profile.routing },
    systemOne: { ...DEFAULT_SYSTEM_ONE, ...settings.systemOne, ...profile.systemOne },
  };
}

export async function syncGlobalProfiles(names) {
  const file = globalConfigPath();
  const raw = await readConfig(file, true, false);
  const profiles = { ...(raw.profiles || {}) };
  for (const name of names) profiles[name] ??= {};
  const result = {
    model: 'default', store: null, format: 'table',
    routing: DEFAULT_ROUTING, systemOne: DEFAULT_SYSTEM_ONE,
    ...raw, profiles,
  };
  const content = JSON.stringify(result, null, 2) + '\n';
  await mkdir(dirname(file), { recursive: true });
  let current = null;
  try { current = await readFile(file, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (current !== content) await writeFile(file, content);
  return names;
}
