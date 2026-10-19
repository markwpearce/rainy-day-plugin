import { formatWhen, meterName } from '../limits.js';
import { listShelf, projectKey } from '../shelf.js';

export function sessionStart(
  input: { session_id?: string; cwd?: string },
  now: number,
): { systemMessage: string; hookSpecificOutput: { hookEventName: 'SessionStart'; additionalContext: string } } | null {
  const items = listShelf(projectKey(input.cwd ?? process.cwd()));
  if (items.length === 0) return null;

  const ready = items.filter((i) => i.resetsAt === undefined || i.resetsAt <= now);
  const waiting = items.filter((i) => !ready.includes(i));
  const notes = items.map((i) => `### [${i.id}] ${i.title}\n${i.note}`).join('\n\n');

  if (ready.length > 0) {
    const titles = ready.map((i) => `"${i.title}"`).join(', ');
    return {
      systemMessage: `rainy-day: you shelved ${titles}, and your usage has reset since. Ask Claude to pick it up.`,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext:
          'rainy-day: there is shelved work for this project whose usage limit has since reset. In your first reply, ' +
          'briefly say what was shelved and ask whether to continue. If the user continues, follow the note and then ' +
          '`rainy-day unshelve <id>`.\n\n' + notes,
      },
    };
  }

  const first = waiting[0];
  const when = first.meter && first.resetsAt ? `; your ${meterName(first.meter)} limit resets ${formatWhen(first.resetsAt)}` : '';
  return {
    systemMessage: `rainy-day: shelved work here ("${first.title}")${when}.`,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `rainy-day: shelved work exists for this project but its usage limit hasn't reset yet. Mention it only if relevant.\n\n${notes}`,
    },
  };
}
