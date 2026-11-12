#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const repo = resolve(import.meta.dirname, '..');
const wrapper = join(repo, 'scripts', 'jeo-systemone.mjs');
const dir = mkdtempSync(join(tmpdir(), 'jeo-systemone-test-'));

async function freePort() {
  const server = createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}

const fakeSource = [
  "#!/usr/bin/env node",
  "const { createServer } = require('node:http');",
  "const { appendFileSync } = require('node:fs');",
  "const port = Number(process.env.JEO_TEST_PORT);",
  "const endpoint = process.env.JEO_TEST_REMOTE ? 'http://example.org:9999' : 'http://127.0.0.1:' + port;",
  "const names = ['julia', 'startlux'];",
  "if (process.argv[2] === 'models') {",
  "  console.log(JSON.stringify({profiles:names.map(name => ({name,runtime:'managed',endpoint,model:name+'-decision',modelPresent:null,autoStart:true}))}));",
  "  process.exit(0);",
  "}",
  "if (process.argv[2] !== '--model' || !names.includes(process.argv[3]) || process.argv[4] !== 'serve') process.exit(2);",
  "if (process.env.JEO_TEST_FAIL) { console.error('JEO_TEST_ADAPTER_FAILED'); process.exit(9); }",
  "appendFileSync(process.env.JEO_TEST_LAUNCHES, process.argv[3] + '\\n');",
  "const name = process.argv[3];",
  "const server = createServer(async (request, response) => {",
  "  response.setHeader('Content-Type','application/json');",
  "  if (request.url === '/health') return response.end(JSON.stringify({status:'ok',model:name+'-decision'}));",
  "  if (request.url === '/v1/models') return response.end(JSON.stringify({data:[{id:name+'-decision'}]}));",
  "  if (request.url === '/v1/systemone') {",
  "    let body=''; for await (const chunk of request) body += chunk;",
  "    const input=JSON.parse(body);",
  "    if (input.model !== name+'-decision') return response.writeHead(400).end('{}');",
  "    const answers=Object.fromEntries(Object.entries(input.questions).map(([id,q]) => {",
  "      if (q.type === 'noul') return [id,{type:'noul',noul:0.97}];",
  "      const labels=Object.keys(q.criteria);",
  "      const probabilities=Object.fromEntries(labels.map((item,i)=>[item,i===0?1:0]));",
  "      return [id,{type:'choice',choice:labels[0],probabilities,confidence:1}];",
  "    }));",
  "    return response.end(JSON.stringify({model:name+'-decision',answers,usage:{input_tokens:100,output_tokens:4}}));",
  "  }",
  "  response.writeHead(404).end('{}');",
  "});",
  "server.listen(port,'127.0.0.1');",
  "process.on('SIGTERM',()=>server.close(()=>process.exit(0)));",
].join('\n');

const stub = join(dir, 'jev-droid');
writeFileSync(stub, fakeSource, { mode: 0o700 });

function env(port, extra = {}) {
  const launches = join(dir, 'launches');
  writeFileSync(launches, '');
  return {
    ...process.env,
    JEO_SYSTEMONE_DROID_BIN: stub,
    JEO_TEST_PORT: String(port),
    JEO_TEST_LAUNCHES: launches,
    JEV_MODE: 'api',
    JEV_API_KEY: 'untrusted-environment-value',
    JEV_CATALOG_PATH: '/missing/overridden.json',
    ...extra,
  };
}

function run(args, environment) {
  return spawnSync(process.execPath, [wrapper, ...args], {
    cwd: repo, env: environment, encoding: 'utf8', timeout: 60000,
  });
}

async function waitUntilReady(port) {
  for (let n = 0; n < 100; n++) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/health', {signal: AbortSignal.timeout(200)});
      if (response.ok) return;
    } catch {}
    await new Promise(done => setTimeout(done, 30));
  }
  throw new Error('Fake model did not start');
}

test('models lists the shared Droid profiles without starting models', async () => {
  const environment = env(await freePort());
  const result = run(['models'], environment);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).profiles.map(p => p.name), ['julia', 'startlux']);
  assert.equal(readFileSync(environment.JEO_TEST_LAUNCHES, 'utf8'), '');
});

test('route uses the fork catalog and closes its owned model', async () => {
  const port = await freePort();
  const environment = env(port);
  const result = run(['route', 'julia', 'Review the React application'], environment);
  assert.equal(result.status, 0, result.stderr);
  const routed = JSON.parse(result.stdout);
  const forkSkills = JSON.parse(readFileSync(join(repo, '.agent-skills', 'skills.json'), 'utf8')).skills.length;
  assert.equal(routed.fullCatalogSkills, forkSkills);
  assert.equal(routed.backend.model, 'julia-decision');
  assert.equal(routed.backend.kind, 'systemone');
  assert.equal(readFileSync(environment.JEO_TEST_LAUNCHES, 'utf8').trim(), 'julia');
  await assert.rejects(fetch('http://127.0.0.1:' + port + '/health', {signal:AbortSignal.timeout(300)}));
});

test('route reuses a running model without shutting it down', async () => {
  const port = await freePort();
  const environment = env(port);
  const model = spawn(stub, ['--model','startlux','serve'], {env: environment, stdio:'ignore'});
  try {
    await waitUntilReady(port);
    const result = run(['route','startlux','Review web accessibility'], environment);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).backend.model, 'startlux-decision');
    assert.equal(readFileSync(environment.JEO_TEST_LAUNCHES, 'utf8').trim(), 'startlux');
    assert.equal((await fetch('http://127.0.0.1:' + port + '/health')).status, 200);
  } finally {
    model.kill('SIGTERM');
    await new Promise(done => model.once('exit', done));
  }
});

test('startup failures include the owning model runtime error', async () => {
  const environment = env(await freePort(), { JEO_TEST_FAIL: '1' });
  const failure = run(['route', 'julia', 'Review code'], environment);
  assert.notEqual(failure.status, 0);
  assert.match(failure.stderr, /JEO_TEST_ADAPTER_FAILED/);
});

test('unknown models and remote endpoints are rejected', async () => {
  const port = await freePort();
  const environment = env(port);
  const missing = run(['route', 'missing', 'Review code'], environment);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Unknown System One profile/);
  const remote = run(['route', 'julia','Review code'], {...environment, JEO_TEST_REMOTE:'1'});
  assert.notEqual(remote.status, 0);
  assert.match(remote.stderr, /loopback/);
  assert.equal(readFileSync(environment.JEO_TEST_LAUNCHES, 'utf8'), '');
});

test('System One caps and timeouts can be bounded for local models', () => {
  const inspector = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import { describeBackend } from './jev/jev-harness.mjs'; console.log(JSON.stringify(describeBackend('systemone')));",
  ], {
    cwd: repo,
    env: {
      ...process.env, HOME: join(dir, 'isolated-home'),
      JEV_MODE: 'systemone',
      JEV_SYSTEMONE_ENDPOINT: 'http://127.0.0.1:8877/v1/systemone',
      JEV_SYSTEMONE_MODEL: 'test-model',
      JEV_SYSTEMONE_TIMEOUT_MS: '120000',
      JEV_SYSTEMONE_MAX_STATE_CHARS: '3000',
    },
    encoding: 'utf8', timeout: 10000,
  });
  assert.equal(inspector.status, 0, inspector.stderr);
  const backend = JSON.parse(inspector.stdout);
  assert.equal(backend.timeoutMs, 120000);
  assert.equal(backend.maxStateChars, 3000);
});

process.on('exit', () => rmSync(dir, {recursive:true,force:true}));
