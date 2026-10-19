import { expect, test } from 'vitest';
import { decidePreToolUse, isOwnCommand } from '../src/gate.js';
import type { Limit, UsageSnapshot } from '../src/types.js';
import type { UsageResult } from '../src/usage/read.js';

const NOW = Date.parse('2026-10-19T19:00:00Z');
const at = (weekly: number): UsageResult => ({
  ok: true,
  stale: false,
  snapshot: { weekly: { usedPct: weekly, resetsAt: NOW + 1e8 }, fetchedAt: NOW } satisfies UsageSnapshot,
});
const limit = (over: Partial<Limit> = {}): Limit => ({
  id: 'w60', meter: 'weekly', stopAt: 60, scope: { kind: 'global' }, until: { kind: 'cleared' },
  createdAt: NOW, warned: false, ...over,
});
const bash = (command: string) => ({ toolName: 'Bash', toolInput: { command } });
const run = (limits: Limit[], usage: UsageResult, tool: { toolName: string; toolInput: unknown } = bash('ls'), unknownReported = false) =>
  decidePreToolUse({ ...tool, sessionId: 's1', limits, usage, now: NOW, unknownReported });

test('no active limits: no output, nothing changes', () => {
  const r = run([limit({ scope: { kind: 'session', sessionId: 'other' } })], at(99));
  expect(r.out).toBeNull();
});

test('unknown usage is reported once per session and never blocks', () => {
  const unknown: UsageResult = { ok: false, reason: 'nope' };
  const first = run([limit()], unknown);
  expect(first.out?.systemMessage).toBe("rainy-day: can't read usage right now (nope), so your limit isn't being enforced.");
  expect(first.reportedUnknown).toBe(true);
  expect(first.out?.hookSpecificOutput?.permissionDecision).toBeUndefined();
  expect(run([limit()], unknown, bash('ls'), true).out).toBeNull();
});

test('near the limit: one heads-up, then quiet', () => {
  const first = run([limit()], at(58));
  expect(first.out?.systemMessage).toBe("FYI: you're at 58% of your weekly usage, and you want to stop at 60%.");
  expect(first.limits[0].warned).toBe(true);
  expect(run(first.limits, at(59)).out).toBeNull();
});

test('reaching the limit trips it: allowed with wrap-up context and a user notice', () => {
  const r = run([limit()], at(61));
  expect(r.limits[0].trippedAt).toBe(NOW);
  expect(r.limits[0].graceLeft).toBe(4);
  expect(r.out?.systemMessage).toBe('rainy-day: weekly usage is at 61%, your limit is 60%. Wrapping up.');
  expect(r.out?.hookSpecificOutput?.permissionDecision).toBeUndefined();
  expect(r.out?.hookSpecificOutput?.additionalContext).toMatch(/Finish only the small step/);
});

test('after the trip, 5 calls in total are allowed, then tool calls are denied', () => {
  let limits = [limit()];
  for (let i = 0; i < 5; i++) {
    const r = run(limits, at(61));
    expect(r.out?.hookSpecificOutput?.permissionDecision).toBeUndefined();
    limits = r.limits;
  }
  const denied = run(limits, at(61));
  expect(denied.out?.hookSpecificOutput?.permissionDecision).toBe('deny');
  expect(denied.out?.hookSpecificOutput?.permissionDecisionReason).toMatch(/rainy-day shelve/);
});

test('under lockout the plugin CLI and AskUserQuestion still get through', () => {
  const locked = [limit({ trippedAt: NOW, graceLeft: 0 })];
  expect(run(locked, at(61), bash("rainy-day shelve --title x <<'EOF'\n| a | b |\nEOF")).out?.hookSpecificOutput?.permissionDecision).toBeUndefined();
  expect(run(locked, at(61), { toolName: 'AskUserQuestion', toolInput: {} }).out?.hookSpecificOutput?.permissionDecision).toBeUndefined();
  expect(run(locked, at(61), bash('rainy-day list && rm -rf x')).out?.hookSpecificOutput?.permissionDecision).toBe('deny');
});

test('own commands during grace do not use up grace', () => {
  const r = run([limit({ trippedAt: NOW, graceLeft: 3 })], at(61), bash('rainy-day status'));
  expect(r.limits[0].graceLeft).toBe(3);
});

test('once usage drops back under the limit (after a reset), trip and warning clear', () => {
  const r = run([limit({ trippedAt: NOW, graceLeft: 0, warned: true })], at(2));
  expect(r.out).toBeNull();
  expect(r.limits[0]).toMatchObject({ warned: false, trippedAt: undefined, graceLeft: undefined });
});

test('isOwnCommand', () => {
  expect(isOwnCommand('Bash', { command: 'rainy-day status' })).toBe(true);
  expect(isOwnCommand('Bash', { command: '  rainy-day' })).toBe(true);
  expect(isOwnCommand('Bash', { command: 'rainy-days' })).toBe(false);
  expect(isOwnCommand('Bash', { command: 'rainy-day status; rm x' })).toBe(false);
  expect(isOwnCommand('Bash', { command: 'rainy-day status | sh' })).toBe(false);
  expect(isOwnCommand('Bash', { command: 'rainy-day $(rm x)' })).toBe(false);
  expect(isOwnCommand('Bash', { command: 'rainy-day shelve <<EOF\n$(rm x)\nEOF' })).toBe(false);
  expect(isOwnCommand('Bash', { command: 'rainy-day status\nrm x' })).toBe(false);
  expect(isOwnCommand('Write', { command: 'rainy-day status' })).toBe(false);
});

test('isOwnCommand rejects background jobs, process substitution, and redirection', () => {
  expect(isOwnCommand('Bash', { command: 'rainy-day status & rm -rf x' })).toBe(false);
  expect(isOwnCommand('Bash', { command: 'rainy-day status <(rm -rf x)' })).toBe(false);
  expect(isOwnCommand('Bash', { command: 'rainy-day status > ~/.zshrc' })).toBe(false);
  expect(isOwnCommand('Bash', { command: 'rainy-day status "$HOME"' })).toBe(false);
});

test('isOwnCommand rejects a heredoc that ends early and runs more', () => {
  expect(isOwnCommand('Bash', { command: "rainy-day shelve --title t <<'EOF'\nEOF\nrm -rf ~\nEOF" })).toBe(false);
});

test('isOwnCommand allows quoted titles containing shell punctuation', () => {
  expect(isOwnCommand('Bash', { command: 'rainy-day shelve --title "Fix A; B | C" --note \'x && y\'' })).toBe(true);
  expect(isOwnCommand('Bash', { command: 'rainy-day set weekly 75 --scope session --until 2026-10-25T09:00 --label "keep 25% for Monday"' })).toBe(true);
  expect(isOwnCommand('Bash', { command: 'rainy-day shelve --title "Dark mode" <<-"NOTE"\nLeft: toggle\nNOTE' })).toBe(true);
});
