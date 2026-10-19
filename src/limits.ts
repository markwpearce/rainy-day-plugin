import { statePath } from './paths.js';
import { readJson, writeJson } from './store.js';
import type { Limit, Meter, UsageSnapshot } from './types.js';

export const GRACE_CALLS = 5;
export const WARN_WITHIN = 5;

const FILE = () => statePath('limits.json');

export const meterName = (m: Meter): string => (m === 'session' ? '5-hour' : 'weekly');

export function formatWhen(epoch: number): string {
  return new Date(epoch).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function loadLimits(): Limit[] {
  return readJson<Limit[]>(FILE(), []);
}

export function saveLimits(limits: Limit[], now = Date.now()): void {
  writeJson(FILE(), limits.filter((l) => !isExpired(l, now)));
}

function isExpired(l: Limit, now: number): boolean {
  return l.until.kind !== 'cleared' && now >= l.until.at;
}

export function addLimit(input: Omit<Limit, 'id' | 'createdAt' | 'warned'>, now: number): Limit {
  const limits = loadLimits();
  const base = `${input.meter[0]}${input.stopAt}`;
  let id = base;
  for (let n = 2; limits.some((l) => l.id === id); n++) id = `${base}-${n}`;
  const limit: Limit = { ...input, id, createdAt: now, warned: false };
  saveLimits([...limits, limit], now);
  return limit;
}

export function removeLimit(id: string): boolean {
  const limits = loadLimits();
  const kept = limits.filter((l) => l.id !== id);
  saveLimits(kept);
  return kept.length !== limits.length;
}

export function clearLimits(): number {
  const n = loadLimits().length;
  saveLimits([]);
  return n;
}

export function activeLimits(all: Limit[], sessionId: string | undefined, now: number): Limit[] {
  return all.filter(
    (l) => !isExpired(l, now) && (l.scope.kind === 'global' || l.scope.sessionId === sessionId),
  );
}

export function assess(limit: Limit, usage: UsageSnapshot): 'ok' | 'near' | 'reached' | 'no-reading' {
  const reading = usage[limit.meter];
  if (!reading) return 'no-reading';
  if (reading.usedPct >= limit.stopAt) return 'reached';
  if (reading.usedPct >= limit.stopAt - WARN_WITHIN) return 'near';
  return 'ok';
}

export function describe(limit: Limit, usage?: UsageSnapshot): string {
  const reading = usage?.[limit.meter];
  const now = reading ? ` (now ${reading.usedPct}%${reading.usedPct >= limit.stopAt ? ', reached' : ''})` : '';
  const scope = limit.scope.kind === 'global' ? 'all sessions' : 'this session only';
  const until =
    limit.until.kind === 'cleared' ? 'until cleared'
    : limit.until.kind === 'reset' ? `until the ${meterName(limit.meter)} reset (${formatWhen(limit.until.at)})`
    : `until ${formatWhen(limit.until.at)}`;
  return `[${limit.id}] ${meterName(limit.meter)}: stop at ${limit.stopAt}%${now}, ${scope}, ${until}`;
}
