import { startServer } from './http.mjs';
import { openPostgres } from './postgres.mjs';

const { DATABASE_URL, EDITOR_CODE, SESSION_SECRET } = process.env;
for (const key of ['DATABASE_URL', 'EDITOR_CODE', 'SESSION_SECRET']) {
  if (!process.env[key]?.trim()) throw new Error('Задайте переменную окружения ' + key);
}
const DB = await openPostgres(DATABASE_URL);
startServer({ DB, EDITOR_CODE, SESSION_SECRET }, { host: '0.0.0.0', protocol: 'https:' });
