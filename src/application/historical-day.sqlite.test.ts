/// <reference types="node" />

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommandGateway } from '../data/command-gateway';
import { migrateDatabase } from '../data/migrations';
import type { AtlasSnapshot } from '../features/atlas/types';
import { createTestSnapshot } from '../test-support/create-test-snapshot';

import { changesForAtlasDayMutation } from './day-mutation';
import { AtlasSnapshotWriter } from './persistence';
import { diffAtlasSnapshots } from './snapshot-diff';
import {
  loadAtlasDayViewFromSQLite,
  loadAtlasSnapshotFromSQLite,
} from './snapshot-loader';

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

describe('historical day projection and writes', () => {
  const opened: AsyncTestDatabase[] = [];

  afterEach(() => {
    for (const database of opened.splice(0)) database.close();
  });

  it('edits task and routine occurrences without changing their state today', async () => {
    const adapter = new AsyncTestDatabase();
    opened.push(adapter);
    const database = adapter as unknown as SQLiteDatabase;
    await migrateDatabase(database);
    const gateway = new CommandGateway(database);
    let clock = new Date('2026-08-31T08:00:00').getTime();
    const writer = new AtlasSnapshotWriter(
      database,
      gateway,
      'history-device',
      () => new Date(clock++),
    );
    const fixture = createTestSnapshot('2026-08-31');
    const seeded: AtlasSnapshot = {
      ...fixture,
      habits: [],
      tasks: [
        {
          ...fixture.tasks[0]!,
          subtasks: [
            {
              id: 'required',
              title: 'Required',
              required: true,
              completed: false,
            },
          ],
        },
      ],
      routines: [
        {
          ...fixture.routines[0]!,
          steps: [
            {
              id: 'step',
              title: 'Step',
              required: true,
              completed: false,
            },
          ],
        },
      ],
    };
    await writer.applyChanges(
      diffAtlasSnapshots(null, seeded, '2026-08-31'),
      seeded,
      '2026-08-31',
    );

    let past = await loadAtlasDayViewFromSQLite({
      database,
      gateway,
      localDate: '2026-08-31',
    });
    await writer.applyChanges(
      changesForAtlasDayMutation(past, {
        kind: 'task.update',
        taskId: 'test-task',
        completed: true,
        subtasks: [{ id: 'required', completed: true }],
      }),
      seeded,
      '2026-08-31',
    );
    past = await loadAtlasDayViewFromSQLite({
      database,
      gateway,
      localDate: '2026-08-31',
    });
    for (const mutation of [
      { kind: 'routine.start', routineId: 'test-routine' } as const,
      {
        kind: 'routine.step',
        routineId: 'test-routine',
        stepId: 'step',
        completed: true,
      } as const,
    ]) {
      await writer.applyChanges(
        changesForAtlasDayMutation(past, mutation),
        seeded,
        '2026-08-31',
      );
      past = await loadAtlasDayViewFromSQLite({
        database,
        gateway,
        localDate: '2026-08-31',
      });
    }
    await writer.applyChanges(
      changesForAtlasDayMutation(past, {
        kind: 'routine.finish',
        routineId: 'test-routine',
        completed: true,
      }),
      seeded,
      '2026-08-31',
    );

    past = await loadAtlasDayViewFromSQLite({
      database,
      gateway,
      localDate: '2026-08-31',
    });
    const today = await loadAtlasSnapshotFromSQLite({
      database,
      gateway,
      now: new Date('2026-09-01T12:00:00'),
    });

    expect(past.tasks[0]).toMatchObject({
      completed: true,
      subtasks: [{ id: 'required', completed: true }],
    });
    expect(past.routines[0]).toMatchObject({
      completed: true,
      running: false,
      steps: [{ id: 'step', completed: true }],
    });
    expect(past.progress).toEqual({ completed: 2, total: 2, ratio: 1 });
    expect(today?.tasks[0]?.completed).toBe(false);
    expect(today?.routines[0]).toMatchObject({
      completed: false,
      running: false,
    });
  });

  it('does not show items that did not exist on the selected date', async () => {
    const adapter = new AsyncTestDatabase();
    opened.push(adapter);
    const database = adapter as unknown as SQLiteDatabase;
    await migrateDatabase(database);
    const gateway = new CommandGateway(database);
    const seeded = createTestSnapshot('2026-09-01');
    const writer = new AtlasSnapshotWriter(
      database,
      gateway,
      'history-device',
      () => new Date('2026-09-01T09:00:00'),
    );
    await writer.applyChanges(
      diffAtlasSnapshots(null, seeded, '2026-09-01'),
      seeded,
      '2026-09-01',
    );

    const past = await loadAtlasDayViewFromSQLite({
      database,
      gateway,
      localDate: '2026-08-31',
    });

    expect(past.habits).toEqual([]);
    expect(past.tasks).toEqual([]);
    expect(past.routines).toEqual([]);
    expect(past.progress).toEqual({ completed: 0, total: 0, ratio: 0 });
  });
});
