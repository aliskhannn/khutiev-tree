import { readFileSync } from 'node:fs';
import postgres from 'postgres';

export async function openPostgres(url) {
  const sql = postgres(url, { max: 3, idle_timeout: 15, connect_timeout: 10, prepare: false, onnotice() {} });
  try {
    await sql.begin(async tx => {
      // Cold starts can overlap while the tables and unique indexes are being created.
      await tx`SELECT pg_advisory_xact_lock(681345922)`;
      for (const name of ['0000_family_proposals', '0001_name_changes']) {
        const migration = readFileSync(new URL('../drizzle/' + name + '.sql', import.meta.url), 'utf8');
        for (const statement of migration.split('--> statement-breakpoint')) {
          await tx.unsafe(statement);
        }
      }
    });
  } catch (error) {
    await sql.end();
    throw error;
  }

  function query(statement, values = []) {
    const rows = () => sql.unsafe(statement, values);
    return {
      bind: (...params) => query(statement, params),
      first: async () => (await rows())[0] ?? null,
      all: async () => ({ results: await rows() }),
    };
  }
  return {
    prepare(statement) {
      let index = 0;
      return query(statement.replaceAll('?', () => '$' + ++index));
    },
    close: () => sql.end(),
  };
}
