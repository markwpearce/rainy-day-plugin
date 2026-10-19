import { activeLimits, assess, GRACE_CALLS, meterName } from './limits.js';
const ALWAYS_ALLOWED_TOOLS = new Set(['AskUserQuestion']);
// Allow-list for the first line: `rainy-day` then plain words, flags, and quoted
// strings that can't expand (no $ or backtick inside double quotes), optionally
// ending in a quoted (literal) heredoc. Anything else could run a second command.
const ARG = String.raw `(?:[\w.%:+/=-]+|"[^"$\x60\\]*"|'[^']*')`;
const OWN_FIRST_LINE = new RegExp(String.raw `^rainy-day(?:[ \t]+${ARG})*(?:[ \t]+<<-?[ \t]*(['"])([A-Za-z_]\w*)\1)?[ \t]*$`);
/** A plain `rainy-day …` invocation, optionally fed a quoted (literal) heredoc. */
export function isOwnCommand(toolName, toolInput) {
    if (toolName !== 'Bash' || typeof toolInput?.command !== 'string')
        return false;
    const lines = toolInput.command.trim().split('\n');
    const m = OWN_FIRST_LINE.exec(lines[0]);
    if (!m)
        return false;
    const delim = m[2];
    if (lines.length === 1)
        return delim === undefined;
    if (delim === undefined)
        return false;
    // The heredoc must end on the last line and nowhere earlier.
    const body = lines.slice(1, -1);
    return lines[lines.length - 1].trim() === delim && body.every((l) => l.trim() !== delim);
}
const wrapUp = (l, used) => `rainy-day: the user's ${meterName(l.meter)} usage budget is reached (${used}% used, limit ${l.stopAt}%, id ${l.id}). ` +
    'Finish only the small step you are in the middle of; start nothing new. Then tell the user where things stand ' +
    `and ask: keep going (\`rainy-day clear ${l.id}\`, or set a higher limit) or shelve the work (\`rainy-day shelve\`). ` +
    'Follow the rainy-day budget skill.';
const lockedOut = (l, used) => `rainy-day: ${meterName(l.meter)} usage budget reached (${used}% used, limit ${l.stopAt}%), so tool calls are paused. ` +
    `Tell the user where things stand and ask: keep going (\`rainy-day clear ${l.id}\`, or set a higher limit) ` +
    'or shelve the work (`rainy-day shelve`).';
export function decidePreToolUse(args) {
    const { toolName, toolInput, sessionId, usage, now } = args;
    const limits = args.limits.map((l) => ({ ...l }));
    const active = activeLimits(limits, sessionId, now);
    let reportedUnknown = args.unknownReported;
    if (active.length === 0)
        return { out: null, limits, reportedUnknown };
    if (!usage.ok) {
        if (reportedUnknown)
            return { out: null, limits, reportedUnknown };
        return {
            out: { systemMessage: `rainy-day: can't read usage right now (${usage.reason}), so your limit isn't being enforced.` },
            limits,
            reportedUnknown: true,
        };
    }
    const own = isOwnCommand(toolName, toolInput) || ALWAYS_ALLOWED_TOOLS.has(toolName);
    const messages = [];
    let context;
    let deny;
    for (const l of active) {
        const used = usage.snapshot[l.meter]?.usedPct;
        const state = assess(l, usage.snapshot);
        if (used === undefined || state === 'no-reading')
            continue;
        if (state === 'ok' || state === 'near') {
            if (l.trippedAt !== undefined || (state === 'ok' && l.warned)) {
                l.trippedAt = undefined;
                l.graceLeft = undefined;
                l.warned = false;
            }
            if (state === 'near' && !l.warned) {
                l.warned = true;
                messages.push(`FYI: you're at ${used}% of your ${meterName(l.meter)} usage, and you want to stop at ${l.stopAt}%.`);
            }
            continue;
        }
        // reached
        if (l.trippedAt === undefined) {
            l.trippedAt = now;
            l.graceLeft = GRACE_CALLS - 1; // this call is the first of the grace calls
            l.warned = true;
            messages.push(`rainy-day: ${meterName(l.meter)} usage is at ${used}%, your limit is ${l.stopAt}%. Wrapping up.`);
            context ??= wrapUp(l, used);
        }
        else if (own) {
            context ??= wrapUp(l, used);
        }
        else if ((l.graceLeft ?? 0) > 0) {
            l.graceLeft = (l.graceLeft ?? 0) - 1;
            context ??= wrapUp(l, used);
        }
        else {
            deny ??= lockedOut(l, used);
        }
    }
    if (deny && !own) {
        return {
            out: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: deny } },
            limits,
            reportedUnknown,
        };
    }
    if (messages.length === 0 && !context)
        return { out: null, limits, reportedUnknown };
    const out = {};
    if (messages.length)
        out.systemMessage = messages.join('\n');
    if (context)
        out.hookSpecificOutput = { hookEventName: 'PreToolUse', additionalContext: context };
    return { out, limits, reportedUnknown };
}
