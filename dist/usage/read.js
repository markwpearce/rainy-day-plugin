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
// --strict-mcp-config: don't start the user's MCP servers just to read usage.
export const USAGE_ARGS = ['--strict-mcp-config', '-p', '/usage'];
function runUsage() {
    const r = spawnSync(claudeBinary(), USAGE_ARGS, {
        env: { ...process.env, RAINY_DAY_PROBE: '1' },
        timeout: 20_000,
        encoding: 'utf8',
    });
    if (r.error)
        return null;
    if (r.status === 0)
        return r.stdout;
    // Keep a failed run's output only when it explains the failure as a login problem.
    const out = `${r.stdout}${r.stderr}`;
    return AUTH_ERROR.test(out) ? out : null;
}
const AUTH_ERROR = /failed to authenticate|not logged in|please run \/login/i;
/**
 * Without a subscription login, `/usage` prints only the session cost summary
 * ("Total cost: …") and no plan meters.
 */
function looksLoggedOut(text) {
    return AUTH_ERROR.test(text) || (/^Total cost:/m.test(text) && !/% used/.test(text));
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
    const reason = text === null
        ? `couldn't run \`${claudeBinary()} -p /usage\``
        : looksLoggedOut(text)
            ? 'the claude CLI is not logged in to your subscription; run `claude auth login`'
            : "couldn't understand the /usage output";
    writeJson(statePath('usage-failure.json'), { at: now, reason });
    return fallback(reason);
}
