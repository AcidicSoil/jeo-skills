#!/usr/bin/env node
// Index only the SKILL.md metadata needed by System One's skill router.
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const FRONTMATTER = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;
const FIELD = {
  description: /^description:[ \t]*(.*)$/,
  category: /^category:[ \t]*(.*)$/,
};

function parseValue(first, tail) {
  if (/^[|>][+\-0-9]*\s*(?:#.*)?$/.test(first)) return tail.join(' ').trim();

  const value = [first, ...tail].join(' ').trim();
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value.startsWith("'")) {
    return value.endsWith("'") ? value.slice(1, -1).replace(/''/g, "'") : null;
  }
  return value.replace(/\s+#.*$/, '').trim();
}

function scalar(lines, field) {
  const start = lines.findIndex(line => FIELD[field].test(line));
  if (start < 0) return null;
  const first = lines[start].match(FIELD[field])[1].trim();
  const tail = [];
  for (const line of lines.slice(start + 1)) {
    if (line && !/^\s/.test(line)) break;
    tail.push(line);
  }
  return parseValue(first, tail);
}

function entry(directory, document) {
  const match = document.match(FRONTMATTER);
  if (!match) return null;
  const lines = match[1].split(/\r?\n/);
  const description = scalar(lines, 'description');
  if (typeof description !== 'string' || !description.trim()) return null;
  const category = scalar(lines, 'category');
  const name = directory;
  return {
    name,
    path: name + '/SKILL.md',
    category: typeof category === 'string' && category.trim() ? category.trim() : 'uncategorized',
    description: description.replace(/\s+/g, ' ').trim(),
  };
}

async function index(root) {
  const folders = (await readdir(root, { withFileTypes: true }))
    .map(item => item.name).sort();
  const skills = [];
  let skipped = 0;
  for (const name of folders) {
    const dir = join(root, name);
    if (!(await stat(dir).catch(() => null))?.isDirectory()) continue;
    try {
      const document = await readFile(join(dir, 'SKILL.md'), 'utf8');
      const skill = entry(name, document);
      if (skill) skills.push(skill);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  const categories = {};
  for (const skill of skills) (categories[skill.category] ??= []).push(skill.name);
  return {
    catalog: {
      version: 1,
      skill_count: skills.length,
      categories,
      model_policies: {},
      skills,
    },
    skipped,
  };
}

async function main() {
  const root = resolve(process.argv[2] || join(homedir(), '.agents', 'skills'));
  if (process.argv.length > 3) throw new Error('Usage: index-installed-skills.mjs [SKILLS_DIRECTORY]');
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw new Error('Not a skills directory: ' + root);
  const { catalog, skipped } = await index(root);
  if (!catalog.skills.length) throw new Error('No valid SKILL.md documents in ' + root);

  const output = join(root, 'skills.json');
  const content = JSON.stringify(catalog, null, 2) + '\n';
  const old = await readFile(output, 'utf8').catch(() => null);
  if (old === content) console.log(`unchanged: ${output} (${catalog.skill_count} skills)`);
  else {
    await writeFile(output, content);
    console.log(`indexed ${catalog.skill_count} skills: ${output}`);
  }
  if (skipped) console.log(`skipped ${skipped} folders without usable SKILL.md metadata`);
}

main().catch(error => {
  console.error('index-installed-skills: ' + error.message);
  process.exitCode = 2;
});
