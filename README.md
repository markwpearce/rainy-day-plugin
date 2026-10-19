# rainy-day

A Claude Code plugin for saving some usage for a rainy day. Tell Claude a
budget in plain words and the plugin holds it:

- "Only use up to 20% of my session usage"
- "Keep 25% of my weekly tokens for Monday"
- "Work on this until I reach 50% usage"

What happens:

- **Near the limit:** one heads-up line. "FYI: you're at 58% of your weekly
  usage, and you want to stop at 60%."
- **At the limit:** Claude finishes the small step it's on (a few tool calls
  of grace), tells you where things stand, and asks: keep going, or shelve it.
  After the grace calls, tool calls are blocked until you decide.
- **Shelve:** Claude writes a note (what's done, what's left, how to resume).
  Next time you start Claude in that project after your usage has reset, it
  offers to pick it back up. Nothing restarts on its own.

## Install

```bash
claude plugin marketplace add markwpearce/rainy-day-plugin
```

```bash
claude plugin install rainy-day@rainy-day
```

Or try it for one session from a local clone, without installing:

```bash
claude --plugin-dir path/to/rainy-day-plugin
```

Needs Node 22+ and a Claude subscription plan (the limits come from `/usage`).

## The `rainy-day` command

Claude drives this for you through the `budget` skill, but you can use it
directly too (it's on the Bash PATH inside Claude sessions):

```
rainy-day status
rainy-day set <session|weekly> <pct> [--add] [--scope global|session] [--until cleared|reset|<ISO date>] [--label "<words>"]
rainy-day clear <id|all>
rainy-day shelve --title "<title>" [--note "<markdown>"]   (note read from stdin if omitted)
rainy-day shelf [--all]
rainy-day unshelve <id>
```

`session` is the 5-hour limit and `weekly` is the weekly all-models limit,
both as shown by `/usage`.

## How it works

- **Reading usage:** hooks run `claude -p "/usage"` (free: 0 tokens, ~2 s)
  and cache the result for 4 minutes in `~/.claude/rainy-day/`. No OAuth
  tokens or undocumented endpoints. In the desktop app it uses the app's
  bundled `claude` (`$CLAUDE_CODE_EXECPATH`).
- **Hooks:** `PreToolUse` (heads-up, wrap-up, lockout), `UserPromptSubmit`
  (tells Claude the active limits), `SessionStart` (shelved-work reminder).
  With no limits set, the `PreToolUse` hook returns immediately without
  reading usage.
- **State:** `~/.claude/rainy-day/` (`limits.json`, `shelf.json`,
  `usage.json`, `usage-failure.json`, `errors.log`). Set `RAINY_DAY_HOME` to use another folder.
- **If usage can't be read,** you're told once per session that the limit
  isn't being enforced. It never pretends.

## Limitations

- Usage numbers are whole percentages and can be up to ~4 minutes old, so a
  heavy burst can run a little past the line before it's caught.
- `/usage` output is meant for people; a format change in a future Claude
  Code version would show up as "usage unknown" until the parser is updated.
- Verified end-to-end in terminal `claude -p` sessions (Claude Code 2.1.303,
  Team plan). Not yet verified in the desktop app or VS Code.

## Development

```bash
npm install
```

```bash
npm test
```

```bash
npm run build
```

`dist/` is committed so the installed plugin needs only Node 22+. Rebuild
and commit it with any source change. Design and plan live in
`docs/superpowers/`.
