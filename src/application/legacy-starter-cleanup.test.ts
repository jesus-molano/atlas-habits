/// <reference types="node" />

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommandGateway } from '../data/command-gateway';
import { migrateDatabase } from '../data/migrations';
import type { AtlasSnapshot } from '../features/atlas/types';
import { createTestSnapshot } from '../test-support/create-test-snapshot';

import {
  LEGACY_STARTER_ITEM_IDS,
  withoutLegacyStarterItems,
} from './legacy-starter-cleanup';
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

function legacySnapshot(): AtlasSnapshot {
  const base = createTestSnapshot();
  const habit = base.habits[0]!;
  const task = base.tasks[0]!;
  const routine = base.routines[0]!;
  return {
    ...base,
    habits: [
      ...LEGACY_STARTER_ITEM_IDS.slice(0, 3).map((id, sortOrder) => ({
        ...habit,
        id,
        title: id,
        sortOrder,
        reminders: [],
      })),
      { ...habit, id: 'user-habit', title: 'User habit', reminders: [] },
    ],
    tasks: LEGACY_STARTER_ITEM_IDS.slice(3, 5).map((id, sortOrder) => ({
      ...task,
      id,
      title: id,
      sortOrder,
    })),
    routines: LEGACY_STARTER_ITEM_IDS.slice(5).map((id, sortOrder) => ({
      ...routine,
      id,
      title: id,
      sortOrder,
    })),
    habitHistory: {
      '2026-08-30': {
        'starter-water': { value: 1, completed: true },
        'user-habit': { value: 1, completed: true },
      },
    },
  };
}

describe('legacy starter cleanup', () => {
  const opened: AsyncTestDatabase[] = [];

  afterEach(() => {
    for (const database of opened.splice(0)) database.close();
  });

  it('filters only the six fixed records and their habit history', () => {
    const previous = legacySnapshot();
    const next = withoutLegacyStarterItems(previous);

    expect(next.habits.map((item) => item.id)).toEqual(['user-habit']);
    expect(next.tasks).toEqual([]);
    expect(next.routines).toEqual([]);
    expect(next.habitHistory['2026-08-30']).toEqual({
      'user-habit': { value: 1, completed: true },
    });
    expect(withoutLegacyStarterItems(next)).toBe(next);
  });

  it('writes durable deletes once and preserves user-created records', async () => {
    const adapter = new AsyncTestDatabase();
    opened.push(adapter);
    const database = adapter as unknown as SQLiteDatabase;
    await migrateDatabase(database);
    const gateway = new CommandGateway(database);
    let clock = new Date('2026-08-31T12:00:00Z').getTime();
    const now = () => new Date(clock++);
    const writer = new AtlasSnapshotWriter(
      database,
      gateway,
      'cleanup-device',
      now,
    );
    const seeded = legacySnapshot();
    await writer.applyChanges(
      diffAtlasSnapshots(null, seeded, '2026-08-31'),
      seeded,
      '2026-08-31',
    );

    const previous = await loadAtlasSnapshotFromSQLite({
      database,
      gateway,
      now: new Date('2026-08-31T12:00:00Z'),
    });
    expect(previous).not.toBeNull();
    const next = withoutLegacyStarterItems(previous!);
    await writer.applyChanges(
      diffAtlasSnapshots(previous, next, '2026-08-31'),
      next,
      '2026-08-31',
    );

    const activeItems = await database.getAllAsync<{ id: string }>(
      'SELECT id FROM items WHERE deleted_at IS NULL ORDER BY id',
    );
    const deleteOperations = await database.getAllAsync<{ entity_id: string }>(
      `SELECT entity_id FROM oplog
       WHERE entity_type = 'item' AND operation = 'delete'
       ORDER BY entity_id`,
    );
    const tombstones = await database.getAllAsync<{ entity_id: string }>(
      `SELECT entity_id FROM tombstones
       WHERE entity_type = 'item'
       ORDER BY entity_id`,
    );

    expect(activeItems).toEqual([{ id: 'user-habit' }]);
    expect(deleteOperations.map((row) => row.entity_id)).toEqual(
      [...LEGACY_STARTER_ITEM_IDS].sort(),
    );
    expect(tombstones.map((row) => row.entity_id)).toEqual(
      [...LEGACY_STARTER_ITEM_IDS].sort(),
    );

    const afterFirstCleanup = await loadAtlasSnapshotFromSQLite({
      database,
      gateway,
      now: new Date('2026-08-31T12:00:00Z'),
    });
    expect(afterFirstCleanup).not.toBeNull();
    const repeated = withoutLegacyStarterItems(afterFirstCleanup!);
    expect(
      diffAtlasSnapshots(afterFirstCleanup, repeated, '2026-08-31'),
    ).toEqual([]);
  });
});
