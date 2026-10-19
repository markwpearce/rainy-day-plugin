import { decidePreToolUse } from '../gate.js';
import { activeLimits, loadLimits, saveLimits } from '../limits.js';
import { statePath } from '../paths.js';
import { readJson, writeJson } from '../store.js';
import { getUsage } from '../usage/read.js';
const REPORTED = () => statePath('unknown-reported.json');
export function preToolUse(input, now, readUsage = () => getUsage({ now })) {
    const limits = loadLimits();
    if (activeLimits(limits, input.session_id, now).length === 0)
        return null;
    const reported = readJson(REPORTED(), []);
    const sessionKey = input.session_id ?? '';
    const result = decidePreToolUse({
        toolName: input.tool_name ?? '',
        toolInput: input.tool_input,
        sessionId: input.session_id,
        limits,
        usage: readUsage(),
        now,
        unknownReported: reported.includes(sessionKey),
    });
    if (JSON.stringify(result.limits) !== JSON.stringify(limits))
        saveLimits(result.limits, now);
    if (result.reportedUnknown && !reported.includes(sessionKey)) {
        writeJson(REPORTED(), [...reported.slice(-50), sessionKey]);
    }
    return result.out;
}
