import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';
import { activeLimits, addLimit, assess, clearLimits, describe as describeLimit, loadLimits, removeLimit } from '../src/limits.js';
import type { Limit, UsageSnapshot } from '../src/types.js';

const NOW = Date.parse('2026-10-19T19:00:00Z');
const usage = (weekly: number, session = 10): UsageSnapshot => ({
  session: { usedPct: session, resetsAt: NOW + 3.6e6 },
  weekly: { usedPct: weekly, resetsAt: Date.parse('2026-10-22T10:00:00Z') },
  fetchedAt: NOW,
});
const weekly75 = { meter: 'weekly', stopAt: 75, scope: { kind: 'global' }, until: { kind: 'cleared' } } as const;

beforeEach(() => {
  process.env.RAINY_DAY_HOME = mkdtempSync(join(tmpdir(), 'rainy-day-'));
});

test('addLimit saves the limit with an id built from meter and stopAt', () => {
  const l = addLimit(weekly75, NOW);
  expect(l.id).toBe('w75');
  expect(loadLimits()).toEqual([l]);
});

test('a clashing id gets a numeric suffix', () => {
  addLimit(weekly75, NOW);
  expect(addLimit(weekly75, NOW).id).toBe('w75-2');
});

test('a session-scoped limit is active only for its session', () => {
  addLimit({ ...weekly75, scope: { kind: 'session', sessionId: 'abc' } }, NOW);
  expect(activeLimits(loadLimits(), 'abc', NOW)).toHaveLength(1);
  expect(activeLimits(loadLimits(), 'other', NOW)).toHaveLength(0);
  expect(activeLimits(loadLimits(), undefined, NOW)).toHaveLength(0);
});

test('expired limits are not active', () => {
  addLimit({ ...weekly75, until: { kind: 'reset', at: NOW - 1 } }, NOW);
  addLimit({ ...weekly75, stopAt: 80, until: { kind: 'date', at: NOW + 1 } }, NOW);
  expect(activeLimits(loadLimits(), undefined, NOW).map((l) => l.id)).toEqual(['w80']);
});

test('assess boundaries around stopAt 75', () => {
  const l = addLimit(weekly75, NOW);
  expect(assess(l, usage(69))).toBe('ok');
  expect(assess(l, usage(70))).toBe('near');
  expect(assess(l, usage(74))).toBe('near');
  expect(assess(l, usage(75))).toBe('reached');
});

test('a limit already passed when set is saved and assesses reached', () => {
  const l = addLimit(weekly75, NOW);
  expect(loadLimits()).toHaveLength(1);
  expect(assess(l, usage(77))).toBe('reached');
});

test('no reading for the meter assesses no-reading', () => {
  const l = addLimit(weekly75, NOW);
  expect(assess(l, { session: usage(1).session, fetchedAt: NOW })).toBe('no-reading');
});

test('removeLimit and clearLimits', () => {
  addLimit(weekly75, NOW);
  addLimit({ ...weekly75, stopAt: 80 }, NOW);
  expect(removeLimit('w75')).toBe(true);
  expect(removeLimit('w75')).toBe(false);
  expect(clearLimits()).toBe(1);
  expect(loadLimits()).toEqual([]);
});

test('describe reads naturally', () => {
  const l: Limit = addLimit(weekly75, NOW);
  expect(describeLimit(l, usage(77))).toBe('[w75] weekly: stop at 75% (now 77%, reached), all sessions, until cleared');
  const s = addLimit({ meter: 'session', stopAt: 36, scope: { kind: 'session', sessionId: 'x' }, until: { kind: 'cleared' } }, NOW);
  expect(describeLimit(s)).toBe('[s36] 5-hour: stop at 36%, this session only, until cleared');
});
