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
export function getUsage(opts = {}) {
    const now = opts.now ?? Date.now();
    const cached = readCachedUsage();
    if (cached && now - cached.fetchedAt < (opts.maxAgeMs ?? DEFAULT_MAX_AGE)) {
        return { ok: true, snapshot: cached, stale: false };
    }
    const text = (opts.run ?? runUsage)();
    const fresh = text === null ? null : parseUsage(text, now);
    if (fresh) {
        writeJson(statePath('usage.json'), fresh);
        return { ok: true, snapshot: fresh, stale: false };
    }
    if (cached && now - cached.fetchedAt < STALE_LIMIT) {
        return { ok: true, snapshot: cached, stale: true };
    }
    return {
        ok: false,
        reason: text === null ? `couldn't run \`${claudeBinary()} -p /usage\`` : "couldn't understand the /usage output",
    };
}
