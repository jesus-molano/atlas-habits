/// <reference types="node" />

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { mapDashboardToAtlasSnapshot } from '../../application/projection';
import { migrateDatabase } from '../migrations';
import { ActionRepository } from '../repositories/action-repository';
import { DashboardRepository } from '../repositories/dashboard-repository';
import { ItemRepository } from '../repositories/item-repository';
import { ProgressRepository } from '../repositories/progress-repository';
import { QueryRepository } from '../repositories/query-repository';
import { ScheduleRepository } from '../repositories/schedule-repository';
import { SyncRepository } from '../repositories/sync-repository';

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

describe('SQLite data layer integration', () => {
  const opened: AsyncTestDatabase[] = [];

  afterEach(() => {
    for (const database of opened.splice(0)) database.close();
  });

  async function setup(): Promise<{
    adapter: AsyncTestDatabase;
    database: SQLiteDatabase;
  }> {
    const adapter = new AsyncTestDatabase();
    opened.push(adapter);
    const database = adapter as unknown as SQLiteDatabase;
    await migrateDatabase(database);
    return { adapter, database };
  }

  it('applies every migration with foreign keys enabled', async () => {
    const { adapter } = await setup();
    expect(adapter.native.prepare('PRAGMA user_version').get()).toEqual({
      user_version: 4,
    });
    expect(adapter.native.prepare('PRAGMA foreign_keys').get()).toEqual({
      foreign_keys: 1,
    });
    expect(adapter.native.prepare('PRAGMA integrity_check').get()).toEqual({
      integrity_check: 'ok',
    });
  });

  it('replays commands without duplicate rows and allocates stable device sequences', async () => {
    const { adapter, database } = await setup();
    const items = new ItemRepository(database);
    const progress = new ProgressRepository(database);
    const command = {
      commandId: 'command-create-water',
      deviceId: 'device-a',
      issuedAt: 1_000,
      payload: {
        id: 'habit-water',
        title: 'Drink water',
        measurementType: 'quantity' as const,
        unit: 'ml',
      },
    };

    expect((await items.createHabit(command)).replayed).toBe(false);
    expect((await items.createHabit(command)).replayed).toBe(true);
    await progress.recordMeasurement({
      commandId: 'command-water-250',
      deviceId: 'device-a',
      issuedAt: 2_000,
      payload: {
        id: 'measurement-water-250',
        itemId: 'habit-water',
        value: 250,
        unit: 'ml',
        operation: 'add',
        occurredAt: 2_000,
        localDate: '2026-08-31',
      },
    });

    expect(
      adapter.native.prepare('SELECT count(*) AS count FROM items').get(),
    ).toEqual({ count: 1 });
    expect(
      adapter.native
        .prepare('SELECT count(*) AS count FROM command_receipts')
        .get(),
    ).toEqual({
      count: 2,
    });
    const pending = await new SyncRepository(database).listPendingOperations(
      'device-a',
    );
    expect(pending.map((entry) => entry.deviceSeq)).toEqual([1, 2]);
    expect(pending.map((entry) => entry.entityType)).toEqual([
      'item',
      'measurement',
    ]);
  });

  it('supports the dashboard, pause, routine and reminder action surface', async () => {
    const { database } = await setup();
    const items = new ItemRepository(database);
    const actions = new ActionRepository(database);
    const queries = new QueryRepository(database);
    await items.createRoutine({
      commandId: 'create-morning-routine',
      deviceId: 'device-a',
      issuedAt: 1_000,
      payload: {
        id: 'routine-morning',
        title: 'Morning',
        steps: [{ id: 'step-water', title: 'Water' }],
      },
    });
    await actions.reorderDashboard({
      commandId: 'reorder-dashboard',
      deviceId: 'device-a',
      issuedAt: 2_000,
      payload: { entries: [{ itemId: 'routine-morning', sortOrder: 10 }] },
    });
    const pause = await actions.pauseItem({
      commandId: 'pause-morning',
      deviceId: 'device-a',
      issuedAt: 3_000,
      payload: {
        id: 'pause-morning',
        itemId: 'routine-morning',
        startDate: '2026-09-01',
      },
    });
    expect(pause.value.pauseId).toBe('pause-morning');
    expect(
      (
        await actions.resumeItem({
          commandId: 'resume-morning',
          deviceId: 'device-a',
          issuedAt: 4_000,
          payload: {
            pauseId: 'pause-morning',
            itemId: 'routine-morning',
            resumeOn: '2026-09-03',
          },
        })
      ).value.endDate,
    ).toBe('2026-09-02');

    const run = await actions.startRoutineRun({
      commandId: 'start-morning',
      deviceId: 'device-a',
      issuedAt: 5_000,
      payload: {
        id: 'run-morning',
        routineId: 'routine-morning',
        localDate: '2026-09-03',
      },
    });
    expect(run.value.stepCount).toBe(1);
    await actions.updateRoutineStep({
      commandId: 'complete-water-step',
      deviceId: 'device-a',
      issuedAt: 6_000,
      payload: {
        routineRunId: 'run-morning',
        stepId: 'step-water',
        status: 'completed',
        startedAt: 5_000,
        finishedAt: 6_000,
        elapsedSeconds: 1,
      },
    });
    await actions.finishRoutineRun({
      commandId: 'finish-morning',
      deviceId: 'device-a',
      issuedAt: 7_000,
      payload: { routineRunId: 'run-morning', status: 'completed' },
    });
    expect((await queries.listRoutineRunSteps('run-morning'))[0]?.status).toBe(
      'completed',
    );

    await actions.upsertReminderRule({
      commandId: 'remind-morning',
      deviceId: 'device-a',
      issuedAt: 8_000,
      payload: {
        id: 'reminder-morning',
        itemId: 'routine-morning',
        localTime: '08:00',
        exactAlarm: true,
        allowSnooze: true,
      },
    });
    expect(
      (await queries.listReminderRules('routine-morning'))[0],
    ).toMatchObject({
      id: 'reminder-morning',
      localTime: '08:00',
      exactAlarm: true,
      allowSnooze: true,
    });
  });

  it('round-trips typed schedules, slots, goals and multiple reminders', async () => {
    const { database } = await setup();
    const items = new ItemRepository(database);
    const actions = new ActionRepository(database);
    const schedules = new ScheduleRepository(database);
    const queries = new QueryRepository(database);
    const created = await items.createHabit({
      commandId: 'create-scheduled-habit',
      deviceId: 'device-a',
      issuedAt: 1_000,
      payload: {
        id: 'habit-run',
        title: 'Correr',
        measurementType: 'boolean',
        defaultValue: 1,
        schedule: {
          id: 'schedule-run',
          timezone: 'Atlantic/Canary',
          effectiveFrom: '2026-08-31',
          ruleType: 'weekdays',
          rule: { days: [1, 3, 5] },
          graceMinutes: 90,
          slots: [
            { key: 'morning', localTime: '07:30', sortOrder: 0 },
            { key: 'evening', localTime: '19:30', sortOrder: 1 },
          ],
          goals: [
            {
              measurementType: 'boolean',
              aggregation: 'sum',
              targetValue: 2,
              unit: 'veces',
            },
          ],
        },
      },
    });
    expect(created.value.scheduleId).toBe('schedule-run');
    await actions.upsertReminderRule({
      commandId: 'reminder-run-morning',
      deviceId: 'device-a',
      issuedAt: 2_000,
      payload: {
        id: 'reminder-morning',
        itemId: 'habit-run',
        localTime: '07:30',
      },
    });
    await actions.upsertReminderRule({
      commandId: 'reminder-run-evening',
      deviceId: 'device-a',
      issuedAt: 2_001,
      payload: {
        id: 'reminder-evening',
        itemId: 'habit-run',
        localTime: '19:30',
      },
    });

    const project = async () => {
      const day = await new DashboardRepository(database).loadDay('2026-09-02');
      return mapDashboardToAtlasSnapshot({
        day,
        now: new Date('2026-09-02T12:00:00'),
        relations: {
          remindersByItemId: {
            'habit-run': await queries.listReminderRules('habit-run'),
          },
        },
      }).habits[0];
    };

    expect(await project()).toMatchObject({
      schedule: {
        kind: 'weekdays',
        days: [1, 3, 5],
        startDate: '2026-08-31',
        slots: [
          { id: 'morning', time: '07:30' },
          { id: 'evening', time: '19:30' },
        ],
      },
      reminders: [
        { id: 'reminder-morning', time: '07:30' },
        { id: 'reminder-evening', time: '19:30' },
      ],
      graceMinutes: 90,
      target: 2,
    });

    const amended = await schedules.addVersion({
      commandId: 'amend-schedule-run',
      deviceId: 'device-a',
      issuedAt: 3_000,
      payload: {
        scheduleId: 'schedule-run',
        version: {
          effectiveFrom: '2026-08-31',
          ruleType: 'interval',
          rule: { every: 2, anchorDate: '2026-08-31' },
          graceMinutes: 30,
          slots: [{ key: 'morning', localTime: '08:00' }],
          goals: [{ measurementType: 'boolean', targetValue: 1 }],
        },
      },
    });
    expect(amended.value.versionNumber).toBe(1);
    expect(await project()).toMatchObject({
      schedule: {
        kind: 'interval_days',
        every: 2,
        anchorDate: '2026-08-31',
        slots: [{ id: 'morning', time: '08:00' }],
      },
      graceMinutes: 30,
    });
  });
});
