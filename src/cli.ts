import { parseArgs } from 'node:util';
import { activeLimits, addLimit, clearLimits, describe, formatWhen, loadLimits, meterName, removeLimit } from './limits.js';
import { listShelf, projectKey, shelve, unshelve } from './shelf.js';
import type { Limit, Meter } from './types.js';
import type { UsageResult } from './usage/read.js';

export interface CliContext {
  env: Record<string, string | undefined>;
  stdin?: string; // only consulted by `shelve` when --note is absent
  now: number;
  cwd: string;
  getUsage: () => UsageResult;
}

export interface CliResult { code: number; out: string }

const USAGE = `Usage:
  rainy-day status
  rainy-day set <session|weekly> <pct> [--add] [--scope global|session] [--until cleared|reset|<ISO date>] [--label "<words>"]
  rainy-day clear <id|all>
  rainy-day shelve --title "<title>" [--note "<markdown>"]   (note read from stdin if omitted)
  rainy-day shelf [--all]
  rainy-day unshelve <id>`;

class CliError extends Error {}
const fail = (msg: string): never => { throw new CliError(msg); };
const ok = (out: string): CliResult => ({ code: 0, out });

function parseMeter(s: string | undefined): Meter {
  if (s === 'session' || s === '5-hour' || s === '5h') return 'session';
  if (s === 'weekly' || s === 'week') return 'weekly';
  return fail(`Unknown meter "${s ?? ''}". Use session (the 5-hour limit) or weekly.`);
}

function parsePct(s: string | undefined): number {
  const n = Number(s?.replace(/%$/, ''));
  if (!s || !Number.isFinite(n) || n <= 0 || n > 100) fail(`"${s ?? ''}" isn't a percentage between 1 and 100.`);
  return Math.round(n);
}

function status(ctx: CliContext): string {
  const usage = ctx.getUsage();
  const lines: string[] = [];
  if (usage.ok) {
    for (const m of ['session', 'weekly'] as const) {
      const r = usage.snapshot[m];
      if (r) lines.push(`${meterName(m)}: ${r.usedPct}% used, resets ${formatWhen(r.resetsAt)}`);
    }
    if (usage.stale) lines.push('(these numbers are from a little while ago; a fresh read failed)');
  } else {
    lines.push(`Usage unknown: ${usage.reason}. Limits are not being enforced.`);
  }
  const limits = activeLimits(loadLimits(), ctx.env.CLAUDE_CODE_SESSION_ID, ctx.now);
  lines.push('', limits.length ? 'Limits:' : 'No limits set.');
  for (const l of limits) lines.push(`  ${describe(l, usage.ok ? usage.snapshot : undefined)}`);
  return lines.join('\n');
}

function set(args: string[], ctx: CliContext): string {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      add: { type: 'boolean' },
      scope: { type: 'string', default: 'global' },
      until: { type: 'string', default: 'cleared' },
      label: { type: 'string' },
    },
  });
  const meter = parseMeter(positionals[0]);
  const pct = parsePct(positionals[1]);
  const usage = ctx.getUsage();
  const reading = usage.ok ? usage.snapshot[meter] : undefined;

  let stopAt = pct;
  if (values.add) {
    if (!reading) return fail(`Can't read current ${meterName(meter)} usage, so "--add" has nothing to add to. Give an absolute percentage instead.`);
    stopAt = Math.min(100, reading.usedPct + pct);
  }

  let scope: Limit['scope'];
  if (values.scope === 'global') scope = { kind: 'global' };
  else if (values.scope === 'session') {
    const sessionId = ctx.env.CLAUDE_CODE_SESSION_ID;
    if (!sessionId) return fail("No CLAUDE_CODE_SESSION_ID in the environment, so a this-session-only limit can't be set. Use --scope global.");
    scope = { kind: 'session', sessionId };
  } else return fail(`Unknown scope "${values.scope}". Use global or session.`);

  let until: Limit['until'];
  if (values.until === 'cleared') until = { kind: 'cleared' };
  else if (values.until === 'reset') {
    if (!reading) return fail(`Can't read the ${meterName(meter)} reset time right now. Use --until cleared or a date.`);
    until = { kind: 'reset', at: reading.resetsAt };
  } else {
    const at = Date.parse(values.until ?? '');
    if (!Number.isFinite(at) || at <= ctx.now) return fail(`"--until ${values.until}" isn't a future date.`);
    until = { kind: 'date', at };
  }

  const limit = addLimit({ meter, stopAt, scope, until, label: values.label }, ctx.now);
  const lines = [`Saved: ${describe(limit, usage.ok ? usage.snapshot : undefined)}`];
  if (reading && reading.usedPct >= stopAt) lines.push('This limit is already reached; the next tool call will start wrapping up.');
  if (!usage.ok) lines.push(`Warning: usage unknown (${usage.reason}), so this limit can't be enforced yet.`);
  return lines.join('\n');
}

function clear(args: string[]): string {
  const id = args[0] ?? fail('Say which limit to clear: an id from `rainy-day status`, or "all".');
  if (id === 'all') return `Cleared ${clearLimits()} limit(s).`;
  return removeLimit(id) ? `Cleared ${id}.` : fail(`No limit with id "${id}".`);
}

function doShelve(args: string[], ctx: CliContext): string {
  const { values } = parseArgs({ args, options: { title: { type: 'string' }, note: { type: 'string' } } });
  const title = values.title?.trim() || fail('--title is required.');
  const note = (values.note ?? ctx.stdin ?? '').trim();
  const tripped = activeLimits(loadLimits(), ctx.env.CLAUDE_CODE_SESSION_ID, ctx.now)
    .filter((l) => l.trippedAt !== undefined)
    .sort((a, b) => (b.trippedAt ?? 0) - (a.trippedAt ?? 0))[0];
  let meter: Meter | undefined;
  let resetsAt: number | undefined;
  if (tripped) {
    meter = tripped.meter;
    const usage = ctx.getUsage();
    resetsAt = usage.ok ? usage.snapshot[meter]?.resetsAt : undefined;
  }
  const item = shelve({ project: projectKey(ctx.cwd), title, note, meter, resetsAt }, ctx.now);
  const when = meter && resetsAt ? ` It'll be offered back after the ${meterName(meter)} reset (${formatWhen(resetsAt)}).` : '';
  return `Shelved "${item.title}" [${item.id}].${when}`;
}

function shelf(args: string[], ctx: CliContext): string {
  const all = args.includes('--all');
  const items = all ? listShelf() : listShelf(projectKey(ctx.cwd));
  if (items.length === 0) return all ? 'Nothing shelved.' : 'Nothing shelved for this project.';
  return items
    .map((i) => {
      const where = all ? ` (${i.project})` : '';
      const reset = i.resetsAt ? (i.resetsAt <= ctx.now ? ', usage has reset since' : `, waits for reset ${formatWhen(i.resetsAt)}`) : '';
      return `[${i.id}] ${i.title}${where}: shelved ${formatWhen(i.shelvedAt)}${reset}\n${i.note.replace(/^/gm, '    ')}`;
    })
    .join('\n\n');
}

export function main(argv: string[], ctx: CliContext): CliResult {
  const [cmd, ...rest] = argv;
  try {
    switch (cmd) {
      case 'status': return ok(status(ctx));
      case 'set': return ok(set(rest, ctx));
      case 'clear': return ok(clear(rest));
      case 'shelve': return ok(doShelve(rest, ctx));
      case 'shelf': return ok(shelf(rest, ctx));
      case 'unshelve':
        return unshelve(rest[0] ?? '') ? ok(`Removed ${rest[0]} from the shelf.`) : fail(`No shelved item "${rest[0] ?? ''}".`);
      case undefined: case 'help': case '--help': case '-h': return ok(USAGE);
      default: return fail(`Unknown command "${cmd}".\n\n${USAGE}`);
    }
  } catch (e) {
    if (e instanceof CliError || (e as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      return { code: 1, out: (e as Error).message };
    }
    throw e;
  }
}
