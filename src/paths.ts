import { homedir } from 'node:os';
import { join } from 'node:path';

// Shared by hooks and the CLI. CLAUDE_PLUGIN_DATA isn't visible to Bash-tool
// commands, so both sides use this fixed location instead.
export function stateDir(): string {
  return process.env.RAINY_DAY_HOME || join(homedir(), '.claude', 'rainy-day');
}

export const statePath = (name: string): string => join(stateDir(), name);
