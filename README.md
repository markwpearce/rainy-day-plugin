# rainy-day

A Claude Code plugin for setting usage budgets in plain language:

- "Only use up to 20% of my session usage"
- "Keep 25% of my weekly tokens for the weekend"
- "Work on this until I reach 50% usage"

**Status:** design in progress. Nothing is built yet.

## What we know so far

- Hooks don't receive plan usage. The status line command does: its stdin JSON
  has `rate_limits.five_hour` and `rate_limits.seven_day`, each with
  `used_percentage` and `resets_at` (epoch seconds). Confirmed on a Team plan
  with Claude Code 2.1.303. The field appears after the session's first reply.
- A plugin can't install the main `statusLine`, so it needs a one-time line in
  the user's `~/.claude/settings.json`.
- The status line doesn't run in the Claude desktop app. Instead, the plugin
  reads usage from `claude -p "/usage"`, which is free (0 tokens) and works
  anywhere hooks can run it.

Design: [docs/superpowers/specs/2026-10-19-rainy-day-design.md](docs/superpowers/specs/2026-10-19-rainy-day-design.md)
