#!/usr/bin/env node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, 'vendor/open-design/question-form');
const tmpRoot = await mkdtemp(path.join(tmpdir(), 'sonik-open-design-question-form-'));
const workRoot = path.join(tmpRoot, 'question-form');

let total = 0;
let failed = 0;

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function partialMatch(actual, expected) {
  if (!isObject(actual) || !isObject(expected)) return Object.is(actual, expected);
  return Object.entries(expected).every(([key, value]) => {
    if (!(key in actual)) return false;
    const actualValue = actual[key];
    if (isObject(value)) return partialMatch(actualValue, value);
    return deepEqual(actualValue, value);
  });
}

const harness = `
const state = globalThis.__openDesignQuestionFormHarness;
function fail(message) { throw new Error(message); }
function inspect(value) { return JSON.stringify(value); }
export function describe(name, fn) { console.log('# ' + name); fn(); }
export function it(name, fn) {
  state.total += 1;
  try {
    const result = fn();
    if (result && typeof result.then === 'function') throw new Error('async tests are not supported by this lightweight harness');
    console.log('ok - ' + name);
  } catch (error) {
    state.failed += 1;
    console.error('not ok - ' + name);
    console.error(error && error.stack ? error.stack : String(error));
  }
}
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function partialMatch(actual, expected) {
  if (!isObject(actual) || !isObject(expected)) return Object.is(actual, expected);
  return Object.entries(expected).every(([key, value]) => {
    if (!(key in actual)) return false;
    const actualValue = actual[key];
    if (isObject(value)) return partialMatch(actualValue, value);
    return deepEqual(actualValue, value);
  });
}
export function expect(actual) {
  return {
    toEqual(expected) { if (!deepEqual(actual, expected)) fail('Expected ' + inspect(actual) + ' to equal ' + inspect(expected)); },
    toBe(expected) { if (!Object.is(actual, expected)) fail('Expected ' + inspect(actual) + ' to be ' + inspect(expected)); },
    toHaveLength(expected) { if (!actual || actual.length !== expected) fail('Expected length ' + expected + ', got ' + (actual && actual.length)); },
    toContain(expected) { if (!actual || !actual.includes(expected)) fail('Expected ' + inspect(actual) + ' to contain ' + inspect(expected)); },
    toMatchObject(expected) { if (!partialMatch(actual, expected)) fail('Expected ' + inspect(actual) + ' to match object ' + inspect(expected)); },
    toBeUndefined() { if (actual !== undefined) fail('Expected undefined, got ' + inspect(actual)); }
  };
}
`;

globalThis.__openDesignQuestionFormHarness = { total: 0, failed: 0 };

async function copyPatched(relative, transform = (text) => text) {
  const from = path.join(sourceRoot, relative);
  const to = path.join(workRoot, relative);
  await mkdir(path.dirname(to), { recursive: true });
  await writeFile(to, transform(await readFile(from, 'utf8')));
}

try {
  const harnessPath = path.join(workRoot, 'test-harness.mjs');
  await mkdir(workRoot, { recursive: true });
  await writeFile(harnessPath, harness);

  await copyPatched('src/runtime/partial-json.ts');
  await copyPatched('src/artifacts/question-form.ts', (text) =>
    text.replace("from '../runtime/partial-json';", "from '../runtime/partial-json.ts';"),
  );
  await copyPatched('tests/artifacts/question-form.test.ts', (text) =>
    text
      .replace("import { describe, expect, it } from 'vitest';", `import { describe, expect, it } from '${pathToFileURL(harnessPath).href}';`)
      .replace("from '../../src/artifacts/question-form';", "from '../../src/artifacts/question-form.ts';"),
  );

  await import(pathToFileURL(path.join(workRoot, 'tests/artifacts/question-form.test.ts')).href);
  total = globalThis.__openDesignQuestionFormHarness.total;
  failed = globalThis.__openDesignQuestionFormHarness.failed;
} finally {
  await rm(tmpRoot, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`[open-design-question-form] ${failed}/${total} tests failed`);
  process.exit(1);
}

console.log(`[open-design-question-form] ${total} copied upstream tests passed`);
