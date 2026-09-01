/// <reference types="node" />

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { mapDashboardToAtlasSnapshot } from '../../application/projection';
import { loadAtlasSnapshotFromSQLite } from '../../application/snapshot-loader';
import type { CommandGateway } from '../command-gateway';
import { migrateDatabase, migrations } from '../migrations';
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
      user_version: 6,
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

  it('keeps one global timer, accumulates paused segments and stores task focus without completion', async () => {
    const { adapter, database } = await setup();
    const items = new ItemRepository(database);
    const progress = new ProgressRepository(database);
    await items.createHabit({
      commandId: 'create-focus-habit',
      deviceId: 'device-a',
      issuedAt: 100,
      payload: {
        id: 'habit-focus',
        title: 'Meditar',
        measurementType: 'duration',
        unit: 'seconds',
      },
    });
    await items.createTask({
      commandId: 'create-focus-task',
      deviceId: 'device-a',
      issuedAt: 200,
      payload: { id: 'task-focus', title: 'Preparar informe' },
    });

    const startedAt = new Date(2026, 8, 1, 12, 0, 0).getTime();
    await progress.startTimer({ itemId: 'habit-focus', startedAt });
    await expect(
      progress.startTimer({
        itemId: 'task-focus',
        startedAt: startedAt + 1_000,
      }),
    ).rejects.toThrow('otro cronómetro');
    await progress.pauseTimer('local-personal', startedAt + 60_000);
    expect(await progress.getActiveTimer()).toMatchObject({
      itemId: 'habit-focus',
      runningSince: null,
      elapsedSeconds: 60,
    });
    await progress.resumeTimer('local-personal', startedAt + 120_000);
    const stopped = await progress.stopTimer({
      commandId: 'stop-focus-habit',
      deviceId: 'device-a',
      issuedAt: startedAt + 150_000,
      payload: { localDate: '2026-09-01', endedAt: startedAt + 150_000 },
    });
    expect(stopped.value.elapsedSeconds).toBe(90);
    expect(await progress.getActiveTimer()).toBeNull();

    await progress.recordManualDuration({
      commandId: 'manual-focus-task',
      deviceId: 'device-a',
      issuedAt: 200_000,
      payload: {
        itemId: 'task-focus',
        seconds: 1_500,
        localDate: '2026-08-30',
      },
    });
    expect(
      adapter.native
        .prepare(
          `SELECT item_id, value, local_date, source
             FROM measurements ORDER BY local_date`,
        )
        .all(),
    ).toEqual([
      {
        item_id: 'task-focus',
        value: 1_500,
        local_date: '2026-08-30',
        source: 'app',
      },
      {
        item_id: 'habit-focus',
        value: 90,
        local_date: '2026-09-01',
        source: 'timer',
      },
    ]);
    await progress.recordMeasurement({
      commandId: 'set-focus-habit-initial',
      deviceId: 'device-a',
      issuedAt: startedAt + 160_000,
      payload: {
        id: 'set-focus-habit-initial',
        itemId: 'habit-focus',
        value: 60,
        operation: 'set',
        unit: 'seconds',
        occurredAt: startedAt + 160_000,
        localDate: '2026-09-01',
      },
    });
    await progress.recordMeasurement({
      commandId: 'set-focus-habit-corrected',
      deviceId: 'device-a',
      issuedAt: startedAt + 170_000,
      payload: {
        id: 'set-focus-habit-corrected',
        itemId: 'habit-focus',
        value: 120,
        operation: 'set',
        unit: 'seconds',
        occurredAt: startedAt + 170_000,
        localDate: '2026-09-01',
      },
    });
    const projected = mapDashboardToAtlasSnapshot({
      day: await new DashboardRepository(database).loadDay('2026-09-01'),
      now: new Date('2026-09-01T12:00:00'),
    });
    expect(
      projected.history.find((day) => day.date === '2026-09-01')?.focusSeconds,
    ).toBe(120);
    expect(
      adapter.native
        .prepare('SELECT COUNT(*) AS count FROM task_instances')
        .get(),
    ).toEqual({ count: 0 });
  });

  it('splits timer measurements across local midnights and clears paused segments on cancel', async () => {
    const { adapter, database } = await setup();
    const items = new ItemRepository(database);
    const progress = new ProgressRepository(database);
    await items.createHabit({
      commandId: 'create-midnight-habit',
      deviceId: 'device-a',
      issuedAt: 100,
      payload: {
        id: 'habit-midnight',
        title: 'Leer',
        measurementType: 'duration',
        unit: 'seconds',
      },
    });
    const firstDate = new Date(2026, 8, 1, 23, 59, 30).getTime();
    const pausedAt = new Date(2026, 8, 2, 0, 0, 30).getTime();
    const resumedAt = new Date(2026, 8, 2, 0, 10, 0).getTime();
    const endedAt = new Date(2026, 8, 2, 0, 11, 0).getTime();

    await progress.startTimer({
      itemId: 'habit-midnight',
      startedAt: firstDate,
    });
    await progress.pauseTimer('local-personal', pausedAt);
    await progress.resumeTimer('local-personal', resumedAt);
    const stopped = await progress.stopTimer({
      commandId: 'stop-midnight-habit',
      deviceId: 'device-a',
      issuedAt: endedAt,
      payload: { localDate: '2026-09-02', endedAt },
    });

    expect(stopped.value.elapsedSeconds).toBe(120);
    expect(
      adapter.native
        .prepare(
          `SELECT local_date, value, session_id
             FROM measurements
            WHERE item_id = ?
            ORDER BY local_date`,
        )
        .all('habit-midnight'),
    ).toEqual([
      {
        local_date: '2026-09-01',
        value: 30,
        session_id: `timer:habit-midnight:${firstDate}`,
      },
      {
        local_date: '2026-09-02',
        value: 90,
        session_id: `timer:habit-midnight:${firstDate}`,
      },
    ]);

    await progress.startTimer({ itemId: 'habit-midnight', startedAt: endedAt });
    await progress.pauseTimer('local-personal', endedAt + 30_000);
    await progress.cancelTimer();
    expect(
      adapter.native
        .prepare('SELECT COUNT(*) AS count FROM active_timer_segments')
        .get(),
    ).toEqual({ count: 0 });

    const raceStartedAt = endedAt + 120_000;
    await progress.startTimer({
      itemId: 'habit-midnight',
      startedAt: raceStartedAt,
    });
    const [stopResult, resumeResult] = await Promise.allSettled([
      progress.stopTimer({
        commandId: 'stop-racing-timer',
        deviceId: 'device-a',
        issuedAt: raceStartedAt + 30_000,
        payload: {
          localDate: '2026-09-02',
          endedAt: raceStartedAt + 30_000,
        },
      }),
      progress.resumeTimer('local-personal', raceStartedAt + 30_000),
    ]);
    expect(stopResult.status).toBe('fulfilled');
    expect(resumeResult.status).toBe('rejected');
    expect(await progress.getActiveTimer()).toBeNull();
  });

  it('migrates one legacy habit timer and leaves ambiguous sessions for recovery', async () => {
    const createVersionFour = async (count: number) => {
      const adapter = new AsyncTestDatabase();
      opened.push(adapter);
      const database = adapter as unknown as SQLiteDatabase;
      for (const migration of migrations.filter(
        (entry) => entry.version <= 4,
      )) {
        await adapter.execAsync(migration.sql);
      }
      await adapter.execAsync('PRAGMA user_version = 4');
      for (let index = 0; index < count; index += 1) {
        await database.runAsync(
          `INSERT INTO items
            (id, workspace_id, type, title, created_at, updated_at)
           VALUES (?, 'local-personal', 'habit', ?, 100, 100)`,
          [`legacy-${index}`, `Legacy ${index}`],
        );
        await database.runAsync(
          `INSERT INTO habits
            (item_id, measurement_type, unit, default_value, timer_started_at)
           VALUES (?, 'duration', 'seconds', 60, ?)`,
          [`legacy-${index}`, 1_000 + index],
        );
      }
      await migrateDatabase(database);
      return { adapter, database };
    };

    const single = await createVersionFour(1);
    expect(
      single.adapter.native
        .prepare('SELECT item_id, running_since FROM active_timer')
        .get(),
    ).toEqual({ item_id: 'legacy-0', running_since: 1_000 });
    expect(
      single.adapter.native
        .prepare('SELECT timer_started_at FROM habits WHERE item_id = ?')
        .get('legacy-0'),
    ).toEqual({ timer_started_at: null });

    const ambiguous = await createVersionFour(2);
    expect(
      ambiguous.adapter.native
        .prepare('SELECT COUNT(*) AS count FROM active_timer')
        .get(),
    ).toEqual({ count: 0 });
    expect(
      await new ProgressRepository(ambiguous.database).listLegacyTimerItemIds(),
    ).toEqual(['legacy-0', 'legacy-1']);
  });

  it('preserves v5 timer data and history when adding daily segments', async () => {
    const adapter = new AsyncTestDatabase();
    opened.push(adapter);
    const database = adapter as unknown as SQLiteDatabase;
    for (const migration of migrations.filter((entry) => entry.version <= 5)) {
      await adapter.execAsync(migration.sql);
    }
    await adapter.execAsync('PRAGMA user_version = 5');
    await adapter.execAsync(`
      INSERT INTO items
        (id, workspace_id, type, title, created_at, updated_at)
      VALUES ('v5-habit', 'local-personal', 'habit', 'Timer heredado', 100, 100);
      INSERT INTO habits
        (item_id, measurement_type, unit, default_value)
      VALUES ('v5-habit', 'duration', 'seconds', 1200);
      INSERT INTO measurements
        (id, item_id, value, operation, unit, occurred_at, local_date,
         source, created_at, updated_at)
      VALUES
        ('v5-measurement', 'v5-habit', 300, 'add', 'seconds', 200,
         '2026-09-01', 'timer', 200, 200);
      INSERT INTO active_timer
        (workspace_id, item_id, started_at, running_since, elapsed_seconds,
         created_at, updated_at)
      VALUES
        ('local-personal', 'v5-habit', 1000, NULL, 120, 1000, 1120);
    `);

    await migrateDatabase(database);

    expect(adapter.native.prepare('PRAGMA user_version').get()).toEqual({
      user_version: 6,
    });
    expect(adapter.native.prepare('PRAGMA foreign_key_check').all()).toEqual(
      [],
    );
    expect(
      adapter.native
        .prepare('SELECT title FROM items WHERE id = ?')
        .get('v5-habit'),
    ).toEqual({ title: 'Timer heredado' });
    expect(
      adapter.native
        .prepare('SELECT value, local_date FROM measurements WHERE id = ?')
        .get('v5-measurement'),
    ).toEqual({ value: 300, local_date: '2026-09-01' });
    expect(
      await new ProgressRepository(database).getActiveTimer(),
    ).toMatchObject({
      itemId: 'v5-habit',
      elapsedSeconds: 120,
      runningSince: null,
    });
    const snapshot = await loadAtlasSnapshotFromSQLite({
      database,
      gateway: {
        progress: new ProgressRepository(database),
        queries: new QueryRepository(database),
      } as CommandGateway,
      now: new Date('2026-09-01T12:00:00'),
    });
    expect(snapshot).toMatchObject({
      activeTimer: { itemId: 'v5-habit', elapsedSeconds: 120 },
      habits: [{ id: 'v5-habit', title: 'Timer heredado' }],
    });
    expect(
      snapshot?.history.find((day) => day.date === '2026-09-01')?.focusSeconds,
    ).toBe(300);
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
