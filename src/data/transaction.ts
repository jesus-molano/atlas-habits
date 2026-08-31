import type { SQLiteDatabase } from 'expo-sqlite';

export type SqlExecutor = Pick<
  SQLiteDatabase,
  'execAsync' | 'getAllAsync' | 'getEachAsync' | 'getFirstAsync' | 'runAsync'
>;

const writeQueues = new WeakMap<SQLiteDatabase, Promise<void>>();

/**
 * Serializes write transactions on the configured connection. Expo's exclusive
 * transaction API opens a second connection; connection-level PRAGMAs such as
 * `foreign_keys` do not carry over to it. Keeping writes on this connection
 * preserves FK enforcement while the queue prevents this data layer from
 * interleaving its own commands.
 */
export async function withWriteTransaction<T>(
  database: SQLiteDatabase,
  task: (transaction: SqlExecutor) => Promise<T>,
): Promise<T> {
  const previous = writeQueues.get(database) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  writeQueues.set(
    database,
    previous.then(() => gate),
  );

  await previous;
  let value: T | undefined;
  let completed = false;

  try {
    await database.withTransactionAsync(async () => {
      value = await task(database);
      completed = true;
    });
  } finally {
    release();
  }

  if (!completed) throw new Error('The database transaction did not complete.');
  return value as T;
}

/** Backward-compatible semantic alias: all writes remain mutually exclusive. */
export const withExclusiveTransaction = withWriteTransaction;
