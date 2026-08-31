import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { migrateDatabase } from './migrations';

export const DATABASE_NAME = 'atlas-habits.db';

let databasePromise: Promise<SQLiteDatabase> | null = null;

export async function initializeDatabase(
  database: SQLiteDatabase,
): Promise<SQLiteDatabase> {
  await migrateDatabase(database);
  return database;
}

export function getDatabase(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = openDatabaseAsync(DATABASE_NAME, {
      enableChangeListener: true,
    })
      .then(initializeDatabase)
      .catch((error: unknown) => {
        databasePromise = null;
        throw error;
      });
  }
  return databasePromise;
}

export async function closeDatabase(): Promise<void> {
  const pending = databasePromise;
  databasePromise = null;
  if (!pending) return;
  const database = await pending;
  await database.closeAsync();
}
