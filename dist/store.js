import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export function readJson(file, fallback) {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    }
    catch {
        return fallback;
    }
}
export function writeJson(file, value) {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
    renameSync(tmp, file);
}
