import { readFileSync } from 'node:fs';
import { main } from './cli.js';
import { getUsage } from './usage/read.js';

const argv = process.argv.slice(2);
const wantsStdin = argv[0] === 'shelve' && !argv.includes('--note') && !process.stdin.isTTY;
let stdin: string | undefined;
if (wantsStdin) {
  try { stdin = readFileSync(0, 'utf8'); } catch { stdin = undefined; }
}
const result = main(argv, { env: process.env, stdin, now: Date.now(), cwd: process.cwd(), getUsage: () => getUsage() });
(result.code === 0 ? process.stdout : process.stderr).write(result.out + '\n');
process.exitCode = result.code;
