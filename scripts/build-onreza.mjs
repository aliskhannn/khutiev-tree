import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'build-onreza');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const path of ['public', 'data', 'drizzle/0000_family_proposals.sql', 'drizzle/0001_name_changes.sql',
  'server/onreza.mjs', 'server/http.mjs', 'server/site.mjs', 'server/api.mjs', 'server/postgres.mjs']) {
  cpSync(join(root, path), join(output, path), { recursive: true });
}
const driver = new URL('../', import.meta.resolve('postgres'));
cpSync(driver, join(output, 'node_modules/postgres'), { recursive: true });

console.log('Готово к запуску в ONREZA Compute: build-onreza/server/onreza.mjs');
