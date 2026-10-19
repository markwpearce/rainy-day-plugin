import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';
import { main } from '../src/cli.js';
import { addLimit, loadLimits, saveLimits } from '../src/limits.js';
import { listShelf } from '../src/shelf.js';
import type { UsageResult } from '../src/usage/read.js';

const NOW = Date.parse('2026-10-19T19:00:00Z');
const WEEK_RESET = Date.parse('2026-10-22T10:00:00Z');
const usage = (session: number, weekly: number): UsageResult => ({
  ok: true,
  stale: false,
  snapshot: { session: { usedPct: session, resetsAt: NOW + 3.6e6 }, weekly: { usedPct: weekly, resetsAt: WEEK_RESET }, fetchedAt: NOW },
});
let cwd: string;
const cli = (argv: string[], opts: { env?: Record<string, string>; stdin?: string; usage?: UsageResult } = {}) =>
  main(argv, { env: opts.env ?? {}, stdin: opts.stdin, now: NOW, cwd, getUsage: () => opts.usage ?? usage(16, 77) });

beforeEach(() => {
  process.env.RAINY_DAY_HOME = mkdtempSync(join(tmpdir(), 'rainy-day-'));
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'rd-proj-')));
});

test('set weekly 75 while at 77% saves it and says it is already reached', () => {
  const r = cli(['set', 'weekly', '75']);
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/\[w75\] weekly: stop at 75% \(now 77%, reached\)/);
  expect(r.out).toMatch(/already reached/);
  expect(loadLimits()).toHaveLength(1);
});

test('set session 20 --add at 16% stops at 36%', () => {
  cli(['set', 'session', '20', '--add']);
  expect(loadLimits()[0].stopAt).toBe(36);
});

test('--scope session uses CLAUDE_CODE_SESSION_ID, and errors without it', () => {
  expect(cli(['set', 'weekly', '90', '--scope', 'session']).code).toBe(1);
  cli(['set', 'weekly', '90', '--scope', 'session'], { env: { CLAUDE_CODE_SESSION_ID: 'abc' } });
  expect(loadLimits()[0].scope).toEqual({ kind: 'session', sessionId: 'abc' });
});

test('--until reset uses the meter reset time', () => {
  cli(['set', 'weekly', '90', '--until', 'reset']);
  expect(loadLimits()[0].until).toEqual({ kind: 'reset', at: WEEK_RESET });
});

test('--add with unknown usage is an error', () => {
  const r = cli(['set', 'session', '20', '--add'], { usage: { ok: false, reason: 'x' } });
  expect(r.code).toBe(1);
});

test('bad input is an error', () => {
  expect(cli(['set', 'monthly', '20']).code).toBe(1);
  expect(cli(['set', 'weekly', 'lots']).code).toBe(1);
  expect(cli(['frobnicate']).code).toBe(1);
});

test('clear one and clear all', () => {
  cli(['set', 'weekly', '80']);
  cli(['set', 'weekly', '90']);
  expect(cli(['clear', 'w80']).code).toBe(0);
  expect(cli(['clear', 'nope']).code).toBe(1);
  expect(cli(['clear', 'all']).out).toMatch(/1/);
  expect(loadLimits()).toEqual([]);
});

test('shelve reads the note from stdin and records the tripped meter', () => {
  const l = addLimit({ meter: 'weekly', stopAt: 75, scope: { kind: 'global' }, until: { kind: 'cleared' } }, NOW);
  saveLimits([{ ...l, trippedAt: NOW, graceLeft: 0 }]);
  const r = cli(['shelve', '--title', 'Feature X'], { stdin: 'Done: a\nLeft: b\n' });
  expect(r.code).toBe(0);
  expect(listShelf(cwd)).toMatchObject([{ title: 'Feature X', note: 'Done: a\nLeft: b', meter: 'weekly', resetsAt: WEEK_RESET }]);
});

test('shelf lists this project, unshelve removes', () => {
  cli(['shelve', '--title', 'Feature X', '--note', 'n']);
  const id = listShelf(cwd)[0].id;
  expect(cli(['shelf']).out).toMatch(/Feature X/);
  expect(cli(['unshelve', id]).code).toBe(0);
  expect(cli(['shelf']).out).toMatch(/Nothing shelved/);
});

test('status shows readings and limits', () => {
  cli(['set', 'weekly', '90']);
  const out = cli(['status']).out;
  expect(out).toMatch(/5-hour: 16% used/);
  expect(out).toMatch(/weekly: 77% used/);
  expect(out).toMatch(/\[w90\]/);
});
