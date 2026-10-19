// Offset (ms) of `timeZone` from UTC at instant `epoch`.
function offsetAt(epoch, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(epoch);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return asUtc - Math.floor(epoch / 1000) * 1000;
}
/** Wall-clock time in an IANA zone → epoch ms. Throws RangeError for an unknown zone. */
export function zonedTimeToEpoch(year, month, day, hour, minute, timeZone) {
    const wall = Date.UTC(year, month - 1, day, hour, minute);
    let guess = wall - offsetAt(wall, timeZone);
    // Re-measure once in case the guess crossed a DST boundary.
    guess = wall - offsetAt(guess, timeZone);
    return guess;
}
/** The calendar date (y, m, d) of `epoch` in `timeZone`. */
export function zonedDate(epoch, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(epoch);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    return { year: get('year'), month: get('month'), day: get('day') };
}
