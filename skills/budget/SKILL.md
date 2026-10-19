---
name: budget
description: Use when the user sets, asks about, or changes a usage budget or limit for Claude — "only use up to 20% of my session", "keep 25% of my weekly tokens for Monday", "work on this until I reach 50% usage", "what's my budget?", "forget the budget" — and when a rainy-day hook says a budget is reached or shelved work is waiting.
---

# Usage budgets (rainy-day)

The `rainy-day` CLI (on PATH in Bash) stores usage limits. Hooks enforce them:
a heads-up near the limit, a wrap-up when it's reached, then tool calls are
paused until the user decides. Your job is to turn the user's words into a
precise limit, and to stop tidily when one is hit.

There are two meters, both percentages of the user's plan:

- `session`: the 5-hour limit ("session usage")
- `weekly`: the weekly all-models limit

## Setting a limit

1. Run `rainy-day status` to get the current readings.
2. Interpret the request. A percentage is a reading on the meter unless the
   user clearly says it's an amount on top of the current reading:
   - "only use up to N%", "until I reach N%", "stop at N%" → stop when the
     meter reads N%: `rainy-day set <meter> N`. At 23%, "up to 25% of my
     session" stops at 25%, not 48%.
   - "keep N% for <day/later>" → stop at 100 − N:
     `rainy-day set <meter> <100−N>`. This usually means every session
     (`--scope global`), which also blocks the work it's being saved for, so
     suggest ending it when that day starts (`--until <ISO date>`).
   - Only explicitly relative wording ("another N%", "N% more", "spend N%
     from here") adds to the current reading: `rainy-day set <meter> N --add`
   - If N is at or below the current reading, say so ("you're already at
     23%") and ask whether they meant a higher line.
   - "tokens" or "credits" with no meter named: weekly if they mention days
     or the week, otherwise ask.
3. If it's unclear whether the limit covers only this session or every
   session on the machine, or how long it lasts, **ask**. Don't default.
   - `--scope session` (this session only) or `--scope global`
   - `--until cleared`, `--until reset` (this meter's next reset), or
     `--until <ISO date>`
4. Before saving, repeat it back with real numbers, e.g. "Weekly is at 76%
   now, so I'll stop at 75%. That's already passed; want 80% instead?"
5. Save it with `--label "<the user's words>"`, and show the CLI's output.

## Checking and clearing

- "What's my budget?" → `rainy-day status`
- "Forget the budget" → `rainy-day clear all`, or `rainy-day clear <id>`

## When a limit is reached

A hook will say the budget is reached. Then:

1. Finish only the small step you are in the middle of, so nothing is left
   half-edited. Start nothing new.
2. Tell the user, in a few lines, where things stand.
3. Ask: **keep going** or **shelve it**.
   - Keep going → `rainy-day clear <id>`, or set a higher limit if they give
     one, then continue.
   - Shelve → write the shelf note, then stop:

```bash
rainy-day shelve --title "<short task name>" <<'EOF'
Task: <what the user asked for>
Done: <what's finished>
Left: <what remains, in order>
Resume: <branch, key files, the very next step>
EOF
```

Use exactly that form (a quoted heredoc, nothing chained with `&&`, `;` or
`|`). While tool calls are paused, only plain `rainy-day` commands are let
through.

## Shelved work

- `rainy-day shelf` lists this project's shelf; `rainy-day shelf --all`
  lists every project's.
- When a session starts and shelved work's limit has reset, the hook adds
  it to your context. In your first reply, say what was shelved and ask
  whether to continue. If yes, follow the note, and when it's picked up run
  `rainy-day unshelve <id>`.

## If usage can't be read

If `rainy-day status` or a hook says usage is unknown, tell the user plainly
that the limit isn't being enforced right now. Never imply it is.
