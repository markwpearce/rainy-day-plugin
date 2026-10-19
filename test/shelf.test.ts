import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';
import { listShelf, projectKey, shelve, unshelve } from '../src/shelf.js';

const NOW = Date.parse('2026-10-19T19:00:00Z');

beforeEach(() => {
  process.env.RAINY_DAY_HOME = mkdtempSync(join(tmpdir(), 'rainy-day-'));
});

test('shelve, list by project, list all, unshelve', () => {
  const a = shelve({ project: '/p/a', title: 'Feature X', note: 'done: 1\nleft: 2', meter: 'weekly', resetsAt: NOW + 1 }, NOW);
  shelve({ project: '/p/b', title: 'Other', note: '' }, NOW);
  expect(a.id).toMatch(/^[a-z0-9]{4}$/);
  expect(a.shelvedAt).toBe(NOW);
  expect(listShelf('/p/a').map((i) => i.title)).toEqual(['Feature X']);
  expect(listShelf()).toHaveLength(2);
  expect(unshelve(a.id)).toBe(true);
  expect(unshelve(a.id)).toBe(false);
  expect(listShelf('/p/a')).toEqual([]);
});

test('projectKey of a subdirectory of a git repo is the repo root', () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'rd-repo-')));
  execFileSync('git', ['init', '-q', repo]);
  const sub = join(repo, 'a', 'b');
  mkdirSync(sub, { recursive: true });
  expect(projectKey(sub)).toBe(repo);
});

test('projectKey outside a repo is the directory itself', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rd-plain-')));
  expect(projectKey(dir)).toBe(dir);
});
