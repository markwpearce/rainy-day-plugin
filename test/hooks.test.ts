import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { preToolUse } from '../src/hooks/pre-tool-use.js';
import { sessionStart } from '../src/hooks/session-start.js';
import { userPromptSubmit } from '../src/hooks/user-prompt-submit.js';
import { addLimit, loadLimits } from '../src/limits.js';
import { statePath } from '../src/paths.js';
import { shelve } from '../src/shelf.js';
import { writeJson } from '../src/store.js';

const NOW = Date.parse('2026-10-19T19:00:00Z');
const root = new URL('..', import.meta.url).pathname;
let cwd: string;

// The compiled entry uses the real clock, so its tests seed the cache at Date.now().
const seedUsage = (weekly: number, fetchedAt = NOW) =>
  writeJson(statePath('usage.json'), { weekly: { usedPct: weekly, resetsAt: fetchedAt + 1e8 }, fetchedAt });
const weekly60 = () => addLimit({ meter: 'weekly', stopAt: 60, scope: { kind: 'global' }, until: { kind: 'cleared' } }, NOW);
const toolInput = (command = 'ls') => ({ session_id: 's1', cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });

beforeAll(() => {
  execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { cwd: root });
});

beforeEach(() => {
  process.env.RAINY_DAY_HOME = mkdtempSync(join(tmpdir(), 'rainy-day-'));
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'rd-proj-')));
});

test('pre-tool-use with no limits does nothing and never reads usage', () => {
  let read = 0;
  expect(preToolUse(toolInput(), NOW, () => (read++, { ok: false, reason: 'x' }))).toBeNull();
  expect(read).toBe(0);
});

test('pre-tool-use with a reached limit emits wrap-up context and saves the trip', () => {
  weekly60();
  seedUsage(61);
  const out = preToolUse(toolInput(), NOW);
  expect(out?.hookSpecificOutput?.additionalContext).toMatch(/Finish only the small step/);
  expect(loadLimits()[0].trippedAt).toBe(NOW);
});

test('pre-tool-use reports unknown usage once per session', () => {
  weekly60();
  const unknown = () => ({ ok: false as const, reason: 'nope' });
  expect(preToolUse(toolInput(), NOW, unknown)?.systemMessage).toMatch(/isn't being enforced/);
  expect(preToolUse(toolInput(), NOW, unknown)).toBeNull();
  expect(preToolUse({ ...toolInput(), session_id: 's2' }, NOW, unknown)?.systemMessage).toMatch(/isn't being enforced/);
});

test('user-prompt-submit lists active limits from cached usage', () => {
  weekly60();
  seedUsage(50);
  const out = userPromptSubmit({ session_id: 's1', cwd }, NOW);
  expect(out?.hookSpecificOutput.additionalContext).toMatch(/\[w60\] weekly: stop at 60% \(now 50%\)/);
  expect(out?.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
});

test('user-prompt-submit does not present a stale cache as current', () => {
  weekly60();
  writeJson(statePath('usage.json'), { weekly: { usedPct: 80, resetsAt: NOW + 1e8 }, fetchedAt: NOW - 2 * 24 * 3.6e6 });
  const ctx = userPromptSubmit({ session_id: 's1', cwd }, NOW)?.hookSpecificOutput.additionalContext;
  expect(ctx).not.toMatch(/now 80%/);
  expect(ctx).toMatch(/usage unknown/);
});

test('user-prompt-submit with no limits does nothing', () => {
  expect(userPromptSubmit({ session_id: 's1', cwd }, NOW)).toBeNull();
});

test('session-start offers shelved work once the reset has passed', () => {
  shelve({ project: cwd, title: 'Feature X', note: 'Left: tests', meter: 'weekly', resetsAt: NOW - 1 }, NOW - 1e6);
  const out = sessionStart({ session_id: 's1', cwd }, NOW);
  expect(out?.systemMessage).toBe('rainy-day: you shelved "Feature X", and your usage has reset since. Ask Claude to pick it up.');
  expect(out?.hookSpecificOutput.additionalContext).toMatch(/Left: tests/);
});

test('session-start mentions shelved work quietly before the reset', () => {
  shelve({ project: cwd, title: 'Feature X', note: '', meter: 'weekly', resetsAt: NOW + 1e8 }, NOW);
  expect(sessionStart({ session_id: 's1', cwd }, NOW)?.systemMessage).toMatch(/^rainy-day: shelved work here \("Feature X"\); your weekly limit resets /);
});

test('session-start with nothing shelved does nothing', () => {
  expect(sessionStart({ session_id: 's1', cwd }, NOW)).toBeNull();
});

test('compiled hook entry prints nothing under RAINY_DAY_PROBE', () => {
  weekly60();
  seedUsage(99, Date.now());
  const r = spawnSync('node', [join(root, 'dist/hooks/entry.js'), 'pre-tool-use'], {
    input: JSON.stringify(toolInput()),
    env: { ...process.env, RAINY_DAY_PROBE: '1' },
    encoding: 'utf8',
  });
  expect(r.status).toBe(0);
  expect(r.stdout).toBe('');
});

test('compiled hook entry emits JSON for a reached limit', () => {
  weekly60();
  seedUsage(99, Date.now());
  const r = spawnSync('node', [join(root, 'dist/hooks/entry.js'), 'pre-tool-use'], {
    input: JSON.stringify(toolInput()),
    env: { ...process.env },
    encoding: 'utf8',
  });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).hookSpecificOutput.hookEventName).toBe('PreToolUse');
});

test('compiled hook entry warns the user when a hook fails', () => {
  writeFileSync(statePath('limits.json'), '{corrupt');
  const r = spawnSync('node', [join(root, 'dist/hooks/entry.js'), 'pre-tool-use'], {
    input: JSON.stringify(toolInput()),
    env: { ...process.env },
    encoding: 'utf8',
  });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).systemMessage).toMatch(/rainy-day hit an error.*limits may not be enforced/);
});
