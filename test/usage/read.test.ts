import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';
import { statePath } from '../../src/paths.js';
import { writeJson } from '../../src/store.js';
import { getUsage } from '../../src/usage/read.js';

const NOW = Date.parse('2026-10-19T19:00:00Z');
const MIN = 60_000;
const OUTPUT = readFileSync(new URL('../fixtures/usage-team-2.1.303.txt', import.meta.url), 'utf8');
const snapAt = (fetchedAt: number) => ({ weekly: { usedPct: 50, resetsAt: NOW + 1e8 }, fetchedAt });

beforeEach(() => {
  process.env.RAINY_DAY_HOME = mkdtempSync(join(tmpdir(), 'rainy-day-'));
});

test('a fresh cache is used without running claude', () => {
  writeJson(statePath('usage.json'), snapAt(NOW - 1 * MIN));
  let calls = 0;
  const r = getUsage({ now: NOW, run: () => (calls++, OUTPUT) });
  expect(calls).toBe(0);
  expect(r).toEqual({ ok: true, snapshot: snapAt(NOW - 1 * MIN), stale: false });
});

test('an old cache is refreshed and the result saved', () => {
  writeJson(statePath('usage.json'), snapAt(NOW - 10 * MIN));
  const r = getUsage({ now: NOW, run: () => OUTPUT });
  expect(r.ok && r.snapshot.weekly?.usedPct).toBe(77);
  expect(r.ok && r.stale).toBe(false);
  expect(JSON.parse(readFileSync(statePath('usage.json'), 'utf8')).weekly.usedPct).toBe(77);
});

test('a failed refresh falls back to a cache under 30 minutes old, marked stale', () => {
  writeJson(statePath('usage.json'), snapAt(NOW - 10 * MIN));
  expect(getUsage({ now: NOW, run: () => null })).toEqual({ ok: true, snapshot: snapAt(NOW - 10 * MIN), stale: true });
});

test('a failed refresh with a cache over 30 minutes old is unknown', () => {
  writeJson(statePath('usage.json'), snapAt(NOW - 31 * MIN));
  const r = getUsage({ now: NOW, run: () => null });
  expect(r.ok).toBe(false);
});

test('a failed refresh with no cache is unknown', () => {
  expect(getUsage({ now: NOW, run: () => null }).ok).toBe(false);
});

test('unparseable output is treated like a failed refresh', () => {
  const r = getUsage({ now: NOW, run: () => 'Something changed in the format' });
  expect(r.ok).toBe(false);
});
