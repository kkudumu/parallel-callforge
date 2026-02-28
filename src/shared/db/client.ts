import pg from "pg";

const { Pool } = pg;

export interface DbClient {
  query<T extends pg.QueryResultRow = any>(
    text: string,
    values?: unknown[]
  ): Promise<pg.QueryResult<T>>;
  end(): Promise<void>;
}

export function createDbClient(connectionString: string): DbClient {
  const pool = new Pool({ connectionString });

  return {
    async query<T extends pg.QueryResultRow = any>(
      text: string,
      values?: unknown[]
    ): Promise<pg.QueryResult<T>> {
      return pool.query<T>(text, values);
    },
    async end(): Promise<void> {
      await pool.end();
    },
  };
}
