import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseUsage } from '../../src/usage/parse.js';
import { zonedTimeToEpoch } from '../../src/usage/zoned.js';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-19T19:00:00Z');

test('parses both meters from a real Team-plan capture', () => {
  expect(parseUsage(fixture('usage-team-2.1.303.txt'), NOW)).toEqual({
    session: { usedPct: 5, resetsAt: Date.parse('2026-10-19T23:30:00Z') },
    weekly: { usedPct: 77, resetsAt: Date.parse('2026-10-22T10:00:00Z') },
    fetchedAt: NOW,
  });
});

test('breakdown percentages are never read as a meter', () => {
  const text = 'Last 24h · 227 requests\n  97% of your usage came from subagent-heavy sessions\n  Top skills: /x 19%\n';
  expect(parseUsage(text, NOW)).toBeNull();
});

test('a reset with no date means the next occurrence of that time', () => {
  const line = 'Current session: 40% used · resets 8:30pm (America/Halifax)';
  expect(parseUsage(line, NOW)?.session?.resetsAt).toBe(Date.parse('2026-10-19T23:30:00Z'));
  const later = Date.parse('2026-10-20T01:00:00Z');
  expect(parseUsage(line, later)?.session?.resetsAt).toBe(Date.parse('2026-10-20T23:30:00Z'));
});

test('a January reset seen in late December rolls into next year', () => {
  const line = 'Current week (all models): 10% used · resets Jan 2 at 7am (America/Halifax)';
  const now = Date.parse('2026-12-30T12:00:00Z');
  expect(parseUsage(line, now)?.weekly?.resetsAt).toBe(Date.parse('2027-01-02T11:00:00Z'));
});

test('only the week line present gives weekly and no session', () => {
  const snap = parseUsage(fixture('usage-weekly-only.txt'), NOW);
  expect(snap?.weekly?.usedPct).toBe(100);
  expect(snap?.session).toBeUndefined();
});

test('an unknown timezone drops that meter', () => {
  const text = 'Current session: 5% used · resets 8:30pm (Mars/Olympus)\nCurrent week (all models): 77% used · resets Oct 22 at 7am (America/Halifax)';
  const snap = parseUsage(text, NOW);
  expect(snap?.session).toBeUndefined();
  expect(snap?.weekly?.usedPct).toBe(77);
});

test('zonedTimeToEpoch handles DST on both sides', () => {
  expect(zonedTimeToEpoch(2026, 7, 1, 12, 0, 'America/Halifax')).toBe(Date.parse('2026-07-01T15:00:00Z'));
  expect(zonedTimeToEpoch(2026, 12, 1, 12, 0, 'America/Halifax')).toBe(Date.parse('2026-12-01T16:00:00Z'));
});
