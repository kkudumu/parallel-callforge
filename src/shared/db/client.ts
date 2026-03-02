import pg from "pg";

const { Pool } = pg;
const DB_CONNECTION_TIMEOUT_MS = 10_000;
const DB_QUERY_TIMEOUT_MS = 30_000;
const DB_LOCK_TIMEOUT_MS = 5_000;
const DB_STATEMENT_TIMEOUT_MS = 30_000;
const DB_IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000;

export interface DbClient {
  query<T extends pg.QueryResultRow = any>(
    text: string,
    values?: unknown[]
  ): Promise<pg.QueryResult<T>>;
  withTransaction?<T>(callback: (tx: DbClient) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

export function createDbClient(connectionString: string): DbClient {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
    query_timeout: DB_QUERY_TIMEOUT_MS,
    lock_timeout: DB_LOCK_TIMEOUT_MS,
    statement_timeout: DB_STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  });

  return {
    async query<T extends pg.QueryResultRow = any>(
      text: string,
      values?: unknown[]
    ): Promise<pg.QueryResult<T>> {
      return pool.query<T>(text, values);
    },
    async withTransaction<T>(callback: (tx: DbClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const tx: DbClient = {
        query<U extends pg.QueryResultRow = any>(
          text: string,
          values?: unknown[]
        ): Promise<pg.QueryResult<U>> {
          return client.query<U>(text, values);
        },
        end(): Promise<void> {
          return Promise.resolve();
        },
      };

      try {
        await client.query("BEGIN");
        const result = await callback(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async end(): Promise<void> {
      await pool.end();
    },
  };
}
