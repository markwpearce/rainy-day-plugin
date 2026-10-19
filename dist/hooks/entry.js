import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { stateDir, statePath } from '../paths.js';
import { preToolUse } from './pre-tool-use.js';
import { sessionStart } from './session-start.js';
import { userPromptSubmit } from './user-prompt-submit.js';
// Hooks must never break Claude: on any error, log it and exit 0 with no output.
const handlers = {
    'pre-tool-use': preToolUse,
    'user-prompt-submit': userPromptSubmit,
    'session-start': sessionStart,
};
function run() {
    // Our own `claude -p /usage` probe runs these hooks too; stay out of its way.
    if (process.env.RAINY_DAY_PROBE === '1')
        return;
    const handler = handlers[process.argv[2] ?? ''];
    if (!handler)
        throw new Error(`unknown hook "${process.argv[2]}"`);
    const raw = readFileSync(0, 'utf8');
    const out = handler(raw.trim() ? JSON.parse(raw) : {}, Date.now());
    if (out)
        process.stdout.write(JSON.stringify(out));
}
try {
    run();
}
catch (e) {
    try {
        mkdirSync(stateDir(), { recursive: true });
        appendFileSync(statePath('errors.log'), `${new Date().toISOString()} ${process.argv[2]}: ${e.stack ?? e}\n`);
    }
    catch {
        // nowhere left to report
    }
}
