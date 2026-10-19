# rainy-day — design

Date: 2026-10-19
Status: approved 2026-10-19

## Why

Mark uses Claude Code for personal projects on weekends. The weekly plan
limit is shared with the work week, so a frivolous weekend project can burn
the allowance needed on Monday. The goal is to "save some for a rainy day":
tell Claude, in plain words, how much usage it may spend, and have that
actually hold — especially on long runs nobody is watching.

Example requests:

- "Only use up to 20% of my session usage"
- "Keep 25% of my weekly tokens for Monday"
- "Work on this until I reach 50% usage"

## Goals

1. Set a usage limit in natural language, against the 5-hour ("session")
   meter or the weekly (all models) meter.
2. Enforce it automatically through hooks, not by Claude remembering to check.
3. Give one heads-up when usage gets close to the limit.
4. At the limit, stop tidily, then let the user choose: keep going, or shelve.
5. Shelved work is remembered and offered back once usage has reset.
6. Works wherever hooks run: terminal, VS Code, and the Claude desktop app.

## Non-goals

- Automatically resuming shelved work after a reset.
- Budgets in dollars, extra-usage spend, or per-model weekly meters.
- Predicting usage or estimating what a task will cost.
- Managing usage on other devices or claude.ai (the meters are account-wide,
  so their usage still shows up in the numbers; we just don't control it).

## Anti-goals (failure even if it "works")

- **Silently not enforcing.** If usage can't be read, the user must be told,
  not left believing a limit is in force.
- **Losing work.** The stop must never leave an edit half-done with no record
  of what was in flight.
- **Nagging.** One heads-up per limit, not one per tool call.
- **Touching credentials.** No reading OAuth tokens, no undocumented HTTP
  endpoints.

## Reading usage

Source of truth: `claude -p "/usage"`, run as a subprocess. Verified on
Claude Code 2.1.303, Team plan:

- Takes ~2.4 s. Costs nothing: `--output-format json` reports 0 turns,
  0 tokens, $0.
- Prints to stdout (MCP-policy warnings go to stderr; ignore stderr):

  ```
  Current session: 3% used · resets Oct 19 at 8:30pm (America/Halifax)
  Current week (all models): 77% used · resets Oct 22 at 7am (America/Halifax)
  ```

  Parse the percent and reset time for both lines, matching on the
  `Current session:` and `Current week (all models):` prefixes only. The
  rest of the output (contribution breakdown under "Last 24h" / "Last 7d")
  also contains percentages and must be ignored. A real capture is in
  `test/fixtures/usage-team-2.1.303.txt`. Other states (100% used, reset
  later today, no usage yet, a missing meter line) can't be captured on
  demand; write synthetic fixtures for them, and anything the parser doesn't
  recognise is "usage unknown" (see Failure). *(Claude's call.)*

Caching: the parsed snapshot is stored in the plugin data dir with a
timestamp. A hook uses the cache if it is younger than a few minutes
(builder's call, ~3–5 min) and refreshes it otherwise. No background timer.

Optional faster source: if the user has the status line hooked up (see
below), the status line's stdin JSON carries `rate_limits.five_hour` and
`rate_limits.seven_day`, each with `used_percentage` and `resets_at` (epoch
seconds). Verified working on Team / 2.1.303 in the terminal, after the
session's first reply; the desktop app does not run the status line. If the
plugin ships a status-line script, it writes the same snapshot file, and
whichever source is freshest wins. This is a nice-to-have, not required.

Failure: if `/usage` can't be run or parsed (binary not found, output
changed, not on a subscription plan), the plugin reports "usage unknown —
limit not enforced" to the user once, and keeps reporting it on status
checks. It does not block work and does not pretend to enforce.

Recursion guard: the plugin's own hooks will fire inside the
`claude -p "/usage"` subprocess. Set an env var (e.g. `RAINY_DAY_PROBE=1`) on
the subprocess and make every hook exit immediately when it is set.

## Setting a limit

A skill teaches Claude to recognise budget requests and turn them into a
concrete limit via the plugin's CLI (a script in the plugin's `bin/`, which
is on the Bash PATH).

A limit has:

- **meter**: `session` (5-hour) or `weekly`
- **stop at**: an absolute percent on that meter
- **scope**: this session only, or all sessions on the machine
- **lasts until**: cleared, the meter resets, or a given date/time

Interpretation rules (Claude applies them, then confirms):

- "Use up to N% of my session/week" / "until I reach N%" → stop when the
  meter reads N%. (Corrected 2026-10-19 after real use: Mark means the
  meter reading, not N more points.)
- Only explicitly relative wording ("another N%", "N% more") adds N to the
  current reading.
- "Keep N% for <day>" → stop at 100 − N.
- Unclear scope or duration → ask. Mark wants this asked case by case, not
  defaulted.

Always repeat the limit back with real numbers before saving it, e.g.
"Weekly is at 76% now. I'll stop at 75% — that's already passed. Want 80%?"

Management: list active limits, clear one, clear all. Natural language
("what's my budget?", "forget the budget") plus the CLI.

## While working

A `PreToolUse` hook (all tools, including subagents' tool calls):

1. Load active limits for this session (session-scoped + global). None →
   allow, done.
2. Get usage (cache or refresh).
3. **Heads-up:** first time usage is within 5 points of a limit, show the
   user one line via `systemMessage`:
   "FYI: you're at 58% weekly, and you want to stop at 60%." Record that it
   was shown so it isn't repeated for that limit.
4. **Limit reached:** see below.

A `UserPromptSubmit` hook adds a short note to Claude's context when limits
are active (what they are, current reading), so Claude knows the budget
without having to ask. Builder decides how terse.

## At the limit: tidy stop

When a limit is first found to be reached:

- The hook tells Claude (via context / deny reason) that the budget is hit:
  finish the current small step, start nothing new.
- A small grace allowance of tool calls (builder's call; ~5) lets Claude
  finish an in-flight edit. After grace, the hook denies every tool call
  except the plugin's own CLI.
- Claude then tells the user the limit was reached, roughly where things
  stand, and asks: **keep going** or **shelve it**.
  - Keep going → Claude raises or clears the limit through the CLI, as the
    user says.
  - Shelve → Claude writes a shelf note through the CLI, then stops.

## Shelving

A shelf note is stored in the plugin data dir, keyed by project (git root,
or cwd if not a repo). It holds:

- what the task was
- what's done, what's left
- what's needed to resume (branch, key files, next step)
- which meter tripped, and its reset time at shelving
- when it was shelved

Nothing resumes on its own.

## Coming back

A `SessionStart` hook checks the shelf for this project:

- Reset has passed since shelving → Claude opens with something like:
  "I was working on feature X but hit your limit. Your usage has reset
  since then — want to continue?"
- Not yet reset → a quieter mention: "There's shelved work here; your weekly
  limit resets Thursday."

Claude can't speak before the user's first message, so "opens with" means
both: the hook shows the user a one-line `systemMessage` at startup, and
adds context so Claude raises it in its first reply. *(Claude's call.)*

The reset check uses the stored reset time, so it doesn't need a usage read
at startup. Users can also list shelved work across all projects, and mark
an item done / remove it.

## How it's built (Claude's calls, not Mark's)

- Claude Code plugin layout: `.claude-plugin/plugin.json`,
  `hooks/hooks.json`, `skills/`, `bin/`, scripts. State ("the plugin data
  dir" above) in `~/.claude/rainy-day/` (`$RAINY_DAY_HOME` overrides), not
  `${CLAUDE_PLUGIN_DATA}`: Bash-tool commands don't receive that variable and
  the CLI must share state with the hooks. Survives plugin updates; never in
  `${CLAUDE_PLUGIN_ROOT}`.
- TypeScript (Mark's call), compiled with `tsc` to `dist/`. The compiled
  `dist/` is committed so an installed plugin needs only Node, with no build
  step (Claude's call; Node 22's built-in type stripping was considered but
  still prints experimental warnings and limits syntax). No runtime
  dependencies; dev dependencies only (TypeScript, test runner). Hooks use
  exec form (`"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/..."]`).
- Unit tests for the `/usage` parser, limit maths, and hook decisions.
- Name: `rainy-day`.

## Left to the builder

- Cache age, grace allowance size, exact message wording.
- Data file formats and layout.
- CLI command names and flags.
- Whether to ship the optional status-line script in v1.

## Known risks to verify early

- `claude` may not be on PATH inside hooks launched by the desktop app or
  VS Code. Find the binary robustly or fail loudly (see Failure).
- Hooks are confirmed to run in the desktop app (this session's
  `SessionStart` hooks ran); confirm the `PreToolUse` deny + `systemMessage`
  behave the same in desktop and VS Code. Do this first in the plan, as a
  throwaway check. If enforcement doesn't work in one of them, ship anyway:
  in that environment the plugin runs in "advisory" mode (Claude follows the
  limit via the `UserPromptSubmit` context, no hard deny) and says so to the
  user, per the "silently not enforcing" anti-goal. *(Claude's call.)*
- `/usage` text format may change between Claude Code versions; the parser
  must fail closed into "usage unknown", never into "0% used".
- Reset times are printed in local time with a timezone name and no year;
  parse carefully around year boundaries.
