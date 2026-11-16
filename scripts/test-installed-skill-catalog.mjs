import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scripts = dirname(fileURLToPath(import.meta.url));
const indexer = join(scripts, 'index-installed-skills.mjs');
const wrapper = join(scripts, 'sync-skill-store.sh');

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'jeo-index-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function skill(root, name, content) {
  const folder = join(root, name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'SKILL.md'), content);
}

function runIndexer(root) {
  return spawnSync(process.execPath, [indexer, root], { encoding: 'utf8' });
}

function catalog(root) {
  return JSON.parse(readFileSync(join(root, 'skills.json'), 'utf8'));
}

test('indexes YAML description forms without external dependencies', t => {
  const root = fixture(t);
  skill(root, 'alpha', '---\nname: alpha\ndescription: |\n  Debug software\n  and trace failures.\ncategory: testing\n---\n# Alpha\n');
  skill(root, 'beta', '---\nname: beta\ndescription: >\n  Improve user\n  interface accessibility.\n---\n# Beta\n');
  skill(root, 'gamma', '---\nname: gamma\ndescription: "Check \\"quoted\\" text and\\nvariants."\ncategory: "development"\n---\n');
  skill(root, 'delta', "---\nname: delta\ndescription: 'Handle user''s skills.'\n---\n");
  skill(root, 'missing', 'Not skill frontmatter');
  mkdirSync(join(root, 'empty'));
  const result = runIndexer(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /indexed 4 skills/);
  assert.match(result.stdout, /skipped 2 folders/);
  const data = catalog(root);
  assert.equal(data.skill_count, 4);
  assert.deepEqual(data.categories, { testing: ['alpha'], uncategorized: ['beta', 'delta'], development: ['gamma'] });
  assert.deepEqual(data.skills.map(s => s.description), [
    'Debug software and trace failures.',
    'Improve user interface accessibility.',
    "Handle user's skills.",
    'Check "quoted" text and variants.',
  ]);
  assert.deepEqual(data.model_policies, {});
  assert.equal(data.skills[0].path, 'alpha/SKILL.md');

  const first = readFileSync(join(root, 'skills.json'), 'utf8');
  const same = runIndexer(root);
  assert.equal(same.status, 0, same.stderr);
  assert.match(same.stdout, /unchanged/);
  assert.equal(readFileSync(join(root, 'skills.json'), 'utf8'), first);
});

test('refreshes added, edited, and removed installed skills', t => {
  const root = fixture(t);
  skill(root, 'alpha', '---\ndescription: First version.\n---\n');
  assert.equal(runIndexer(root).status, 0);
  skill(root, 'alpha', '---\ndescription: Updated version.\n---\n');
  skill(root, 'beta', '---\ndescription: New skill.\n---\n');
  assert.equal(runIndexer(root).status, 0);
  assert.deepEqual(catalog(root).skills.map(s => s.description), ['Updated version.', 'New skill.']);
  rmSync(join(root, 'alpha'), { recursive: true });
  assert.equal(runIndexer(root).status, 0);
  assert.deepEqual(catalog(root).skills.map(s => s.name), ['beta']);
});

test('wrapper syncs a selected store from any cwd', t => {
  const root = fixture(t);
  const store = join(root, 'custom');
  skill(store, 'alpha', '---\ndescription: Review code.\n---\n');
  const result = spawnSync('bash', [wrapper, store], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(catalog(store).skill_count, 1);
});

test('wrapper defaults to HOME installed skills store', t => {
  const home = fixture(t);
  const store = join(home, '.agents', 'skills');
  skill(store, 'default', '---\ndescription: Routing skill.\n---\n');
  const result = spawnSync('bash', [wrapper], {
    cwd: home, env: { ...process.env, HOME: home }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(catalog(store).skill_count, 1);
});

test('rejects a missing or entirely invalid store', t => {
  const root = fixture(t);
  assert.notEqual(runIndexer(join(root, 'absent')).status, 0);
  mkdirSync(join(root, 'bad'), { recursive: true });
  skill(join(root, 'bad'), 'empty', 'not frontmatter');
  assert.notEqual(runIndexer(join(root, 'bad')).status, 0);
});
