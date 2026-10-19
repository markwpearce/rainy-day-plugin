import { zonedDate, zonedTimeToEpoch } from './zoned.js';
const DAY = 24 * 60 * 60 * 1000;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const METER_LINES = {
    session: /^Current session:\s*(\d{1,3})% used\s*·\s*resets (.+?) \(([^)]+)\)\s*$/,
    weekly: /^Current week \(all models\):\s*(\d{1,3})% used\s*·\s*resets (.+?) \(([^)]+)\)\s*$/,
};
const WHEN = /^(?:([A-Za-z]{3})[a-z]* (\d{1,2}) at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i;
function parseReset(when, timeZone, now) {
    const m = WHEN.exec(when.trim());
    if (!m)
        return undefined;
    const [, mon, dayStr, hourStr, minStr, ampm] = m;
    let hour = Number(hourStr) % 12;
    if (ampm.toLowerCase() === 'pm')
        hour += 12;
    const minute = minStr ? Number(minStr) : 0;
    try {
        const today = zonedDate(now, timeZone);
        if (!mon) {
            // Time only: next occurrence after now.
            let at = zonedTimeToEpoch(today.year, today.month, today.day, hour, minute, timeZone);
            if (at <= now) {
                const tomorrow = zonedDate(now + DAY, timeZone);
                at = zonedTimeToEpoch(tomorrow.year, tomorrow.month, tomorrow.day, hour, minute, timeZone);
            }
            return at;
        }
        const month = MONTHS.indexOf(mon.toLowerCase()) + 1;
        if (month === 0)
            return undefined;
        let at = zonedTimeToEpoch(today.year, month, Number(dayStr), hour, minute, timeZone);
        if (at < now - DAY)
            at = zonedTimeToEpoch(today.year + 1, month, Number(dayStr), hour, minute, timeZone);
        return at;
    }
    catch {
        return undefined; // unknown timezone
    }
}
/** Parse `claude -p "/usage"` output. Null when no meter line is recognised. */
export function parseUsage(text, now) {
    const snap = { fetchedAt: now };
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        for (const meter of ['session', 'weekly']) {
            const m = METER_LINES[meter].exec(line);
            if (!m)
                continue;
            const usedPct = Number(m[1]);
            const resetsAt = parseReset(m[2], m[3], now);
            if (usedPct > 100 || resetsAt === undefined)
                continue;
            const reading = { usedPct, resetsAt };
            snap[meter] = reading;
        }
    }
    return snap.session || snap.weekly ? snap : null;
}
