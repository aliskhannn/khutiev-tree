import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migrations = ['0000_family_proposals.sql', '0001_name_changes.sql'].map(
  file => readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'),
);

export function openDatabase(filename = ':memory:') {
  const connection = new DatabaseSync(filename);
  connection.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  for (const sql of migrations) connection.exec(sql);

  function query(statement, values = []) {
    return {
      bind: (...params) => query(statement, params),
      first: () => statement.get(...values) ?? null,
      all: () => ({ results: statement.all(...values) }),
      run: () => {
        const { changes } = statement.run(...values);
        return { success: true, meta: { changes } };
      },
    };
  }
  return {
    prepare: sql => query(connection.prepare(sql)),
    close: () => connection.close(),
  };
}
