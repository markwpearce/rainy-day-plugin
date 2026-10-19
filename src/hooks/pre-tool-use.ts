import { decidePreToolUse, type HookOut } from '../gate.js';
import { activeLimits, loadLimits, saveLimits } from '../limits.js';
import { statePath } from '../paths.js';
import { readJson, writeJson } from '../store.js';
import { getUsage, type UsageResult } from '../usage/read.js';

export interface PreToolUseInput {
  session_id?: string;
  tool_name?: string;
  tool_input?: unknown;
}

const REPORTED = () => statePath('unknown-reported.json');

export function preToolUse(input: PreToolUseInput, now: number, readUsage: () => UsageResult = () => getUsage({ now })): HookOut | null {
  const limits = loadLimits();
  if (activeLimits(limits, input.session_id, now).length === 0) return null;

  const reported = readJson<string[]>(REPORTED(), []);
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

  if (JSON.stringify(result.limits) !== JSON.stringify(limits)) saveLimits(result.limits, now);
  if (result.reportedUnknown && !reported.includes(sessionKey)) {
    writeJson(REPORTED(), [...reported.slice(-50), sessionKey]);
  }
  return result.out;
}
