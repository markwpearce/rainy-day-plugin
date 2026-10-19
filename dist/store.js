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
/** Like readJson, but a file that exists and can't be parsed is an error, not "empty". */
export function readJsonStrict(file, fallback) {
    let text;
    try {
        text = readFileSync(file, 'utf8');
    }
    catch {
        return fallback;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        throw new Error(`${file} is corrupt; fix or delete it`);
    }
}
export function writeJson(file, value) {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
    renameSync(tmp, file);
}
