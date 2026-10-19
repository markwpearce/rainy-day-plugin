import { activeLimits, describe, loadLimits } from '../limits.js';
import { readFreshCachedUsage } from '../usage/read.js';

export function userPromptSubmit(
  input: { session_id?: string; cwd?: string },
  now: number,
): { hookSpecificOutput: { hookEventName: 'UserPromptSubmit'; additionalContext: string } } | null {
  const limits = activeLimits(loadLimits(), input.session_id, now);
  if (limits.length === 0) return null;
  // Cached numbers only: this runs on every prompt and must stay fast.
  const usage = readFreshCachedUsage(now) ?? undefined;
  const lines = limits.map((l) => `- ${describe(l, usage)}`);
  if (!usage) lines.push('- (usage unknown right now, so these limits may not be enforced)');
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `rainy-day usage limits are active (manage with the \`rainy-day\` CLI; see the budget skill):\n${lines.join('\n')}`,
    },
  };
}
