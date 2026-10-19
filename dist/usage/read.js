import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { statePath } from '../paths.js';
import { readJson, writeJson } from '../store.js';
import { parseUsage } from './parse.js';
const MIN = 60_000;
const DEFAULT_MAX_AGE = 4 * MIN;
const STALE_LIMIT = 30 * MIN;
/** The desktop app sets CLAUDE_CODE_EXECPATH to its bundled binary; otherwise rely on PATH. */
export function claudeBinary() {
    const exec = process.env.CLAUDE_CODE_EXECPATH;
    return exec && existsSync(exec) ? exec : 'claude';
}
function runUsage() {
    const r = spawnSync(claudeBinary(), ['-p', '/usage'], {
        env: { ...process.env, RAINY_DAY_PROBE: '1' },
        timeout: 20_000,
        encoding: 'utf8',
    });
    return r.error || r.status !== 0 ? null : r.stdout;
}
export function readCachedUsage() {
    return readJson(statePath('usage.json'), null);
}
/** The cached snapshot, or null when it's too old to present as current. */
export function readFreshCachedUsage(now) {
    const cached = readCachedUsage();
    return cached && now - cached.fetchedAt < STALE_LIMIT ? cached : null;
}
export function getUsage(opts = {}) {
    const now = opts.now ?? Date.now();
    const maxAge = opts.maxAgeMs ?? DEFAULT_MAX_AGE;
    const cached = readCachedUsage();
    if (cached && now - cached.fetchedAt < maxAge) {
        return { ok: true, snapshot: cached, stale: false };
    }
    const fallback = (reason) => cached && now - cached.fetchedAt < STALE_LIMIT ? { ok: true, snapshot: cached, stale: true } : { ok: false, reason };
    // Don't re-run a failing probe on every tool call; wait out the cache interval.
    const failure = readJson(statePath('usage-failure.json'), null);
    if (failure && now - failure.at < maxAge)
        return fallback(failure.reason);
    const text = (opts.run ?? runUsage)();
    const fresh = text === null ? null : parseUsage(text, now);
    if (fresh) {
        writeJson(statePath('usage.json'), fresh);
        return { ok: true, snapshot: fresh, stale: false };
    }
    const reason = text === null ? `couldn't run \`${claudeBinary()} -p /usage\`` : "couldn't understand the /usage output";
    writeJson(statePath('usage-failure.json'), { at: now, reason });
    return fallback(reason);
}
