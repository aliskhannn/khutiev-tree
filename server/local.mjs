import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, linkSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { openDatabase } from './sqlite.mjs';
import { startServer } from './http.mjs';

const base = fileURLToPath(new URL('../', import.meta.url));
const state = process.env.FAMILY_STATE_DIR || join(base, '.family');
mkdirSync(state, { recursive: true, mode: 0o700 });

function storedCode(filename, size) {
  const path = join(state, filename);
  try {
    return readFileSync(path, 'utf8').trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temp = join(state, '.new-' + randomUUID());
  writeFileSync(temp, randomBytes(size).toString('base64url') + '\n', { mode: 0o600, flag: 'wx' });
  try {
    linkSync(temp, path);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    unlinkSync(temp);
  }
  return readFileSync(path, 'utf8').trim();
}

const env = {
  DB: openDatabase(join(state, 'tree.sqlite')),
  EDITOR_CODE: process.env.EDITOR_CODE || storedCode('editor-code.txt', 18),
  SESSION_SECRET: process.env.SESSION_SECRET || storedCode('session-key', 32),
};
startServer(env, { host: process.env.FAMILY_HOST || '127.0.0.1' });
