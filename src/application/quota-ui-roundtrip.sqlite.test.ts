/// <reference types="node" />

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommandGateway } from '../data/command-gateway';
import { migrateDatabase } from '../data/migrations';
import type { AtlasSnapshot } from '../features/atlas/types';

import { AtlasSnapshotWriter } from './persistence';
import { diffAtlasSnapshots } from './snapshot-diff';
import { loadAtlasSnapshotFromSQLite } from './snapshot-loader';

vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));

class AsyncTestDatabase {
  readonly native = new DatabaseSync(':memory:');

  async execAsync(source: string): Promise<void> {
    this.native.exec(source);
  }

  async getFirstAsync<T>(
    source: string,
    params: SQLInputValue[] = [],
  ): Promise<T | null> {
    return (
      (this.native.prepare(source).get(...params) as T | undefined) ?? null
    );
  }

  async getAllAsync<T>(
    source: string,
    params: SQLInputValue[] = [],
  ): Promise<T[]> {
    return this.native.prepare(source).all(...params) as T[];
  }

  async runAsync(
    source: string,
    params: SQLInputValue[] = [],
  ): Promise<SQLiteRunResult> {
    const result = this.native.prepare(source).run(...params);
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.native.exec('BEGIN');
    try {
      await task();
      this.native.exec('COMMIT');
    } catch (error) {
      this.native.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.native.close();
  }
}

describe('period quota UI round trip', () => {
  const opened: AsyncTestDatabase[] = [];

  afterEach(() => {
    for (const database of opened.splice(0)) database.close();
  });

  it('persists three same-day taps as three sessions and projects 0 → 1 → 2 → 3', async () => {
    const adapter = new AsyncTestDatabase();
    opened.push(adapter);
    const database = adapter as unknown as SQLiteDatabase;
    await migrateDatabase(database);
    const gateway = new CommandGateway(database);
    await gateway.items.createHabit({
      commandId: 'create-ui-quota',
      deviceId: 'ui-device',
      issuedAt: new Date('2026-08-31T08:00:00Z').getTime(),
      payload: {
        id: 'habit-ui-quota',
        title: 'Entrenar',
        measurementType: 'boolean',
        unit: 'vez',
        defaultValue: 1,
        schedule: {
          timezone: 'Europe/Madrid',
          effectiveFrom: '2026-08-31',
          ruleType: 'period_quota',
          rule: { period: 'week', quota: 3, weekStartsOn: 1 },
          goals: [
            {
              measurementType: 'boolean',
              aggregation: 'sum',
              comparison: 'at_least',
              targetValue: 3,
              unit: 'vez',
            },
          ],
        },
      },
    });

    let clock = new Date('2026-09-02T09:00:00Z').getTime();
    const now = () => new Date(clock++);
    const writer = new AtlasSnapshotWriter(database, gateway, 'ui-device', now);
    const read = async (): Promise<AtlasSnapshot> => {
      const snapshot = await loadAtlasSnapshotFromSQLite({
        database,
        gateway,
        now: new Date('2026-09-02T12:00:00Z'),
      });
      if (!snapshot) throw new Error('Expected a materialized snapshot.');
      return snapshot;
    };

    let canonical = await read();
    expect(canonical.habits[0]).toMatchObject({
      value: 0,
      target: 3,
      completed: false,
    });

    for (let value = 1; value <= 3; value += 1) {
      const optimistic: AtlasSnapshot = {
        ...canonical,
        habits: canonical.habits.map((habit) =>
          habit.id === 'habit-ui-quota'
            ? { ...habit, value, completed: value === 3 }
            : habit,
        ),
      };
      const changes = diffAtlasSnapshots(canonical, optimistic, '2026-09-02');
      expect(changes).toContainEqual(
        expect.objectContaining({ kind: 'habit.progress', value: 1 }),
      );
      await writer.applyChanges(changes, optimistic, '2026-09-02');
      canonical = await read();
      expect(canonical.habits[0]).toMatchObject({
        value,
        target: 3,
        completed: value === 3,
      });
    }

    expect(
      adapter.native
        .prepare(
          `SELECT COUNT(*) AS count,
                  COUNT(DISTINCT occurrence_key) AS occurrences,
                  COUNT(DISTINCT session_id) AS sessions,
                  SUM(value) AS value,
                  MIN(operation) AS operation
             FROM measurements
            WHERE item_id = 'habit-ui-quota' AND deleted_at IS NULL`,
        )
        .get(),
    ).toEqual({
      count: 3,
      occurrences: 3,
      sessions: 3,
      value: 3,
      operation: 'add',
    });
  });
});
