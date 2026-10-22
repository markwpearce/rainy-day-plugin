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

test('cost-only output from a logged-out CLI says to log in', () => {
  const loggedOut = readFileSync(new URL('../fixtures/usage-logged-out-2.1.304.txt', import.meta.url), 'utf8');
  const r = getUsage({ now: NOW, run: () => loggedOut });
  expect(r.ok).toBe(false);
  expect(!r.ok && r.reason).toMatch(/not logged in.*claude auth login/);
});

test('an authentication error says to log in', () => {
  const r = getUsage({ now: NOW, run: () => 'Failed to authenticate: OAuth session expired and could not be refreshed' });
  expect(!r.ok && r.reason).toMatch(/claude auth login/);
});

test('after a failed refresh, the next call within the cache interval does not re-run claude', () => {
  let calls = 0;
  const failing = () => (calls++, null);
  getUsage({ now: NOW, run: failing });
  const r = getUsage({ now: NOW + 1 * MIN, run: failing });
  expect(calls).toBe(1);
  expect(r.ok).toBe(false);
  getUsage({ now: NOW + 5 * MIN, run: failing });
  expect(calls).toBe(2);
});

test('readFreshCachedUsage ignores a cache older than 30 minutes', async () => {
  const { readFreshCachedUsage } = await import('../../src/usage/read.js');
  writeJson(statePath('usage.json'), snapAt(NOW - 31 * MIN));
  expect(readFreshCachedUsage(NOW)).toBeNull();
  writeJson(statePath('usage.json'), snapAt(NOW - 10 * MIN));
  expect(readFreshCachedUsage(NOW)).toEqual(snapAt(NOW - 10 * MIN));
});

test('the usage probe skips MCP servers', async () => {
  const { USAGE_ARGS } = await import('../../src/usage/read.js');
  expect(USAGE_ARGS).toEqual(['--strict-mcp-config', '-p', '/usage']);
});
