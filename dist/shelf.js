import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { statePath } from './paths.js';
import { readJson, writeJson } from './store.js';
const FILE = () => statePath('shelf.json');
const load = () => readJson(FILE(), []);
/** Git repo root for `cwd`, or `cwd` itself when it isn't in a repo. */
export function projectKey(cwd) {
    const r = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    const root = r.status === 0 ? r.stdout.trim() : '';
    try {
        return realpathSync(root || cwd);
    }
    catch {
        return root || cwd;
    }
}
export function shelve(item, now) {
    const items = load();
    let id;
    do
        id = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
    while (items.some((i) => i.id === id));
    const saved = { ...item, id, shelvedAt: now };
    writeJson(FILE(), [...items, saved]);
    return saved;
}
export function listShelf(project) {
    const items = load();
    return project === undefined ? items : items.filter((i) => i.project === project);
}
export function unshelve(id) {
    const items = load();
    const kept = items.filter((i) => i.id !== id);
    writeJson(FILE(), kept);
    return kept.length !== items.length;
}
