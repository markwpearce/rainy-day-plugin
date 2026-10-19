# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

rainy-day is a Claude Code plugin: plain-language usage budgets (5-hour "session" and weekly meters) enforced by hooks, plus a `rainy-day` CLI and a `budget` skill that Claude drives. Node 22+, TypeScript, ESM, no runtime dependencies.

## Commands

```bash
npm test                              # vitest run (all tests)
npx vitest run test/gate.test.ts      # one file
npx vitest run -t "reached limit"     # tests matching a name
npm run check                         # typecheck only (tsc --noEmit)
npm run build                         # compile src/ -> dist/ (tsconfig.build.json)
claude --plugin-dir .                 # try the plugin in one session without installing
```

**`dist/` is committed** — the installed plugin runs it directly with no build step. Rebuild and commit `dist/` with every source change. `test/hooks.test.ts` and `test/cli.test.ts` build `dist/` in `beforeAll` and spawn the compiled entry points, so they exercise the real output.

## Architecture

Three surfaces share one state directory, `~/.claude/rainy-day/` (override with `RAINY_DAY_HOME`; tests set it to a temp dir in `beforeEach`). `CLAUDE_PLUGIN_DATA` isn't visible to Bash-tool commands, which is why both sides use this fixed path (`src/paths.ts`). All writes go through `writeJson` in `src/store.ts` (temp file + rename); reads fall back to defaults on any error.

- **Hooks** (`hooks/hooks.json` → `dist/hooks/entry.js <event>`): `entry.ts` dispatches to `pre-tool-use`, `user-prompt-submit` or `session-start`. A hook must never break Claude: any exception is appended to `errors.log` and the hook exits 0 with no output.
- **CLI** (`bin/rainy-day` → `dist/bin.js` → `src/cli.ts`): `status`, `set`, `clear`, `shelve`, `shelf`, `unshelve`. Session-scoped limits use `CLAUDE_CODE_SESSION_ID` from the environment.
- **Skill** (`skills/budget/SKILL.md`): tells Claude how to turn user wording into `rainy-day set` calls (`--add` for "use N% more", `100−N` for "keep N%") and how to wrap up or shelve when a limit is reached. Hook messages in `src/gate.ts` refer to this skill, so keep the two consistent.

### Reading usage (`src/usage/`)

`read.ts` runs `claude -p /usage` (0 tokens, ~2 s), parses its human-readable output with `parse.ts` (timezone handling in `zoned.ts`), and caches it in `usage.json` for 4 minutes. A failed probe is recorded in `usage-failure.json` and not retried until the cache interval passes. A cached reading up to 30 minutes old is used as a stale fallback. The probe sets `RAINY_DAY_PROBE=1`, and `entry.ts` exits immediately when it sees that, because the child `claude` runs these same hooks. In the desktop app, `CLAUDE_CODE_EXECPATH` points to the bundled binary. Parser fixtures from real output are in `test/fixtures/`. If the `/usage` format changes, the result shows up as "usage unknown" and the parser needs updating.

### Enforcement (`src/gate.ts`, `src/limits.ts`)

`decidePreToolUse` is a pure function: it takes limits, usage, tool call and `now`, and returns the hook output plus updated limits. `pre-tool-use.ts` only does the I/O around it. It returns early, without reading usage, when no limits are active. For each limit:

- within `WARN_WITHIN` (5) points: one "FYI" heads-up (`warned` flag)
- reached: set `trippedAt`, inject wrap-up context, allow `GRACE_CALLS` (5) more tool calls, then deny
- usage drops back under the limit: trip state is reset

While locked out, plain `rainy-day …` Bash commands (`isOwnCommand`) and `AskUserQuestion` still go through. `isOwnCommand` uses a strict allow-list regex: plain args, non-expanding quotes, and an optional quoted heredoc that must end on the last line. Anything that could chain a second command (`&&`, `;`, `|`, `$`, backticks) is rejected. That's why the skill requires the exact `rainy-day shelve <<'EOF'` form. Treat changes to this regex as security-sensitive and cover them in `test/gate.test.ts`.

Limits store an absolute `stopAt` percent, a `scope` (global or one session id) and an `until` (cleared / meter reset / date). Expired limits are dropped on every save. IDs look like `s48`, `w75-2`.

### Shelf (`src/shelf.ts`)

Shelved notes are keyed by project: the git toplevel of `cwd` (realpath), or `cwd` itself outside a repo. `session-start` shows shelved work for the current project and asks Claude to offer resuming only once the meter's `resetsAt` has passed. `user-prompt-submit` lists active limits on every prompt using cached usage only, so it stays fast.

## Docs

The design spec and implementation plan are in `docs/superpowers/specs/` and `docs/superpowers/plans/`.
