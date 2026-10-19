import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';
import { stateDir } from '../src/paths.js';
import { readJson, writeJson } from '../src/store.js';

beforeEach(() => {
  process.env.RAINY_DAY_HOME = mkdtempSync(join(tmpdir(), 'rainy-day-'));
});

test('stateDir honours RAINY_DAY_HOME', () => {
  expect(stateDir()).toBe(process.env.RAINY_DAY_HOME);
});

test('writeJson then readJson round-trips, creating parent dirs', () => {
  const file = join(stateDir(), 'nested', 'x.json');
  writeJson(file, { a: 1 });
  expect(readJson(file, null)).toEqual({ a: 1 });
});

test('readJson returns the fallback for a missing file', () => {
  expect(readJson(join(stateDir(), 'nope.json'), [])).toEqual([]);
});

test('readJson returns the fallback for a corrupt file', () => {
  const file = join(stateDir(), 'bad.json');
  writeFileSync(file, '{not json');
  expect(readJson(file, 'fb')).toBe('fb');
});

test('readJsonStrict returns the fallback for a missing file but throws on a corrupt one', async () => {
  const { readJsonStrict } = await import('../src/store.js');
  expect(readJsonStrict(join(stateDir(), 'nope.json'), [])).toEqual([]);
  const file = join(stateDir(), 'bad.json');
  writeFileSync(file, '{not json');
  expect(() => readJsonStrict(file, [])).toThrow(/bad\.json/);
});
