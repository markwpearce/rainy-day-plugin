import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Like readJson, but a file that exists and can't be parsed is an error, not "empty". */
export function readJsonStrict<T>(file: string, fallback: T): T {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${file} is corrupt; fix or delete it`);
  }
}

export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, file);
}
