/// <reference types="node" />

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { OptionalAtlasSync } from '../application/optional-sync';
import { AtlasSnapshotWriter } from '../application/persistence';
import type { CommandGateway } from '../data/command-gateway';
import { migrateDatabase } from '../data/migrations';
import { recordMutation } from '../data/oplog';
import { ActionRepository } from '../data/repositories/action-repository';
import { ItemRepository } from '../data/repositories/item-repository';
import { ProgressRepository } from '../data/repositories/progress-repository';
import { QueryRepository } from '../data/repositories/query-repository';
import { ScheduleRepository } from '../data/repositories/schedule-repository';
import { withWriteTransaction } from '../data/transaction';
import type { AtlasSnapshot, HabitItem } from '../features/atlas/types';

import { mergePullEnvelope } from './merge';
import { verifySyncSegment } from './segments';
import type {
  OptionalSyncProvider,
  SyncCursor,
  SyncPullResult,
  SyncSegmentEnvelope,
  SyncTransport,
  SyncUploadResult,
} from './types';

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

async function deterministicHash(value: string): Promise<string> {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').repeat(8);
}

class SharedMemoryTransport implements SyncTransport {
  readonly providerId = 'test-remote';
  private readonly segments = new Map<
    string,
    Map<string, SyncSegmentEnvelope>
  >();

  async uploadSegments(
    segments: readonly SyncSegmentEnvelope[],
  ): Promise<SyncUploadResult> {
    let created = 0;
    let alreadyPresent = 0;
    for (const segment of segments) {
      await verifySyncSegment(segment, deterministicHash);
      const device = this.segments.get(segment.deviceId) ?? new Map();
      const previous = device.get(segment.segmentId);
      if (previous) {
        if (previous.contentHash !== segment.contentHash) {
          throw new Error('Immutable test segment conflict.');
        }
        alreadyPresent += 1;
      } else {
        device.set(segment.segmentId, segment);
        this.segments.set(segment.deviceId, device);
        created += 1;
      }
    }
    return { created, alreadyPresent };
  }

  async pull(
    cursor: SyncCursor,
    options: Readonly<{ maxSegmentsPerDevice?: number }> = {},
  ): Promise<SyncPullResult> {
    const maximum = options.maxSegmentsPerDevice ?? 100;
    const incoming: SyncSegmentEnvelope[] = [];
    const hasMoreByDevice: Record<string, boolean> = {};
    for (const [deviceId, byId] of this.segments) {
      const pending = [...byId.values()]
        .filter(
          (segment) =>
            segment.lastSeq > (cursor.lastSeqByDevice[deviceId] ?? 0),
        )
        .sort((left, right) => left.firstSeq - right.firstSeq);
      incoming.push(...pending.slice(0, maximum));
      hasMoreByDevice[deviceId] = pending.length > maximum;
    }
    return mergePullEnvelope(cursor, incoming, hasMoreByDevice);
  }
}

function remoteProvider(transport: SyncTransport): OptionalSyncProvider {
  const user = {
    uid: 'atlas-owner',
    displayName: 'Atlas Owner',
    email: 'atlas@example.test',
    photoUrl: null,
  };
  return {
    mode: 'remote',
    providerId: 'firebase',
    auth: {
      providerId: 'test-auth',
      getSession: async () => user,
      restoreSession: async () => user,
      signIn: async () => user,
      signOut: async () => undefined,
    },
    transport,
  };
}

function snapshotWithHabit(habit: HabitItem): AtlasSnapshot {
  return {
    schemaVersion: 1,
    habits: [habit],
    tasks: [],
    routines: [],
    dashboardOrder: ['habits', 'tasks', 'routines'],
    history: [],
    habitHistory: {},
    sync: { status: 'local-only' },
    source: 'local_store',
  };
}

function testGateway(database: SQLiteDatabase): CommandGateway {
  return {
    actions: new ActionRepository(database),
    items: new ItemRepository(database),
    progress: new ProgressRepository(database),
    queries: new QueryRepository(database),
    schedules: new ScheduleRepository(database),
  } as CommandGateway;
}

describe('bidirectional SQLite sync', () => {
  const opened: AsyncTestDatabase[] = [];

  afterEach(() => {
    for (const database of opened.splice(0)) database.close();
  });

  async function setupDatabase(): Promise<{
    adapter: AsyncTestDatabase;
    database: SQLiteDatabase;
  }> {
    const adapter = new AsyncTestDatabase();
    opened.push(adapter);
    const database = adapter as unknown as SQLiteDatabase;
    await migrateDatabase(database);
    return { adapter, database };
  }

  function syncClient(
    database: SQLiteDatabase,
    deviceId: string,
    transport: SyncTransport,
    now: () => number = () => 100_000,
  ): OptionalAtlasSync {
    return new OptionalAtlasSync(
      database,
      deviceId,
      remoteProvider(transport),
      {
        hashText: deterministicHash,
        now,
        maxSegmentsPerDevice: 4,
      },
    );
  }

  async function insertCategoryAndTag(database: SQLiteDatabase): Promise<void> {
    await withWriteTransaction(database, async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO categories
          (id, workspace_id, name, sort_order, created_at, updated_at)
         VALUES ('category-health', 'local-personal', 'Health', 0, 1000, 1000)`,
      );
      await recordMutation(transaction, {
        commandId: 'create-category-health',
        deviceId: 'device-a',
        entityType: 'category',
        entityId: 'category-health',
        operation: 'upsert',
        payload: { id: 'category-health', name: 'Health' },
        now: 1_000,
      });
      await transaction.runAsync(
        `INSERT INTO tags
          (id, workspace_id, name, created_at, updated_at)
         VALUES ('tag-morning', 'local-personal', 'Morning', 1100, 1100)`,
      );
      await recordMutation(transaction, {
        commandId: 'create-tag-morning',
        deviceId: 'device-a',
        entityType: 'tag',
        entityId: 'tag-morning',
        operation: 'upsert',
        payload: { id: 'tag-morning', name: 'Morning' },
        now: 1_100,
      });
    });
  }

  async function seedCompleteGraph(database: SQLiteDatabase): Promise<void> {
    await insertCategoryAndTag(database);
    const items = new ItemRepository(database);
    const actions = new ActionRepository(database);
    const progress = new ProgressRepository(database);

    await items.createHabit({
      commandId: 'create-water',
      deviceId: 'device-a',
      issuedAt: 2_000,
      payload: {
        id: 'habit-water',
        title: 'Water',
        categoryId: 'category-health',
        tagIds: ['tag-morning'],
        measurementType: 'quantity',
        unit: 'ml',
        defaultValue: 250,
        schedule: {
          id: 'schedule-water',
          timezone: 'UTC',
          effectiveFrom: '2026-08-31',
          ruleType: 'daily',
          rule: { label: 'Daily' },
          slots: [{ id: 'slot-water', key: 'default', localTime: '08:00' }],
          goals: [
            {
              id: 'goal-water',
              slotId: 'slot-water',
              measurementType: 'quantity',
              targetValue: 2_000,
              unit: 'ml',
            },
          ],
        },
      },
    });
    await items.createTask({
      commandId: 'create-task',
      deviceId: 'device-a',
      issuedAt: 3_000,
      payload: {
        id: 'task-shoes',
        title: 'Prepare shoes',
        priority: 2,
        subtasks: [{ id: 'subtask-laces', title: 'Check laces' }],
      },
    });
    await items.createRoutine({
      commandId: 'create-routine',
      deviceId: 'device-a',
      issuedAt: 4_000,
      payload: {
        id: 'routine-morning',
        title: 'Morning routine',
        steps: [{ id: 'step-water', title: 'Drink water' }],
      },
    });
    await actions.reorderDashboard({
      commandId: 'layout-a',
      deviceId: 'device-a',
      issuedAt: 5_000,
      payload: { entries: [{ itemId: 'habit-water', sortOrder: 10 }] },
    });
    await actions.pauseItem({
      commandId: 'pause-water',
      deviceId: 'device-a',
      issuedAt: 6_000,
      payload: {
        id: 'pause-water',
        itemId: 'habit-water',
        startDate: '2026-09-01',
        endDate: '2026-09-02',
      },
    });
    await progress.recordMeasurement({
      commandId: 'measure-water',
      deviceId: 'device-a',
      issuedAt: 7_000,
      payload: {
        id: 'measurement-water',
        itemId: 'habit-water',
        occurrenceKey: 'habit-water:2026-08-31',
        value: 250,
        unit: 'ml',
        occurredAt: 7_000,
        localDate: '2026-08-31',
      },
    });
    await progress.setOccurrenceOverride({
      commandId: 'override-water',
      deviceId: 'device-a',
      issuedAt: 8_000,
      payload: {
        id: 'override-water',
        itemId: 'habit-water',
        occurrenceKey: 'habit-water:2026-08-31',
        localDate: '2026-08-31',
        state: 'complete',
        value: 250,
      },
    });
    await progress.setTaskInstanceStatus({
      commandId: 'complete-task',
      deviceId: 'device-a',
      issuedAt: 9_000,
      payload: {
        id: 'task-instance-shoes',
        taskId: 'task-shoes',
        occurrenceKey: 'task-shoes:2026-08-31',
        localDate: '2026-08-31',
        status: 'completed',
      },
    });
    await withWriteTransaction(database, async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO task_instance_subtasks
          (task_instance_id, subtask_id, completed, completed_at, updated_at)
         VALUES ('task-instance-shoes', 'subtask-laces', 1, 10000, 10000)`,
      );
      await recordMutation(transaction, {
        commandId: 'complete-subtask',
        deviceId: 'device-a',
        entityType: 'task_instance_subtask',
        entityId: 'task-instance-shoes:subtask-laces',
        operation: 'upsert',
        payload: {
          taskInstanceId: 'task-instance-shoes',
          subtaskId: 'subtask-laces',
          completed: true,
          completedAt: 10_000,
          updatedAt: 10_000,
        },
        now: 10_000,
      });
    });
    await actions.startRoutineRun({
      commandId: 'start-routine',
      deviceId: 'device-a',
      issuedAt: 11_000,
      payload: {
        id: 'run-morning',
        routineId: 'routine-morning',
        occurrenceKey: 'routine-morning:2026-08-31',
        localDate: '2026-08-31',
      },
    });
    await actions.updateRoutineStep({
      commandId: 'finish-routine-step',
      deviceId: 'device-a',
      issuedAt: 12_000,
      payload: {
        routineRunId: 'run-morning',
        stepId: 'step-water',
        status: 'completed',
        startedAt: 11_000,
        finishedAt: 12_000,
        elapsedSeconds: 1,
      },
    });
    await actions.finishRoutineRun({
      commandId: 'finish-routine',
      deviceId: 'device-a',
      issuedAt: 12_500,
      payload: { routineRunId: 'run-morning', status: 'completed' },
    });
    await actions.upsertReminderRule({
      commandId: 'reminder-water',
      deviceId: 'device-a',
      issuedAt: 13_000,
      payload: {
        id: 'reminder-water',
        itemId: 'habit-water',
        scheduleSlotId: 'slot-water',
        localTime: '08:00',
        allowSnooze: true,
      },
    });
    await withWriteTransaction(database, async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO reminder_deliveries
          (id, reminder_rule_id, occurrence_key, scheduled_at, acted_at, action)
         VALUES ('delivery-water', 'reminder-water', 'habit-water:2026-08-31',
                 15000, 14000, 'snooze')`,
      );
      await recordMutation(transaction, {
        commandId: 'snooze-water',
        deviceId: 'device-a',
        entityType: 'reminder_delivery',
        entityId: 'delivery-water',
        operation: 'upsert',
        payload: {
          id: 'delivery-water',
          reminderRuleId: 'reminder-water',
          occurrenceKey: 'habit-water:2026-08-31',
          scheduledAt: 15_000,
          actedAt: 14_000,
          action: 'snooze',
        },
        now: 14_000,
      });
      await transaction.runAsync(
        `UPDATE habits SET timer_started_at = 15000 WHERE item_id = 'habit-water'`,
      );
      await recordMutation(transaction, {
        commandId: 'timer-water',
        deviceId: 'device-a',
        entityType: 'habit',
        entityId: 'habit-water',
        operation: 'upsert',
        payload: { timerStartedAt: 15_000, updatedAt: 15_000 },
        changedFields: ['timerStartedAt'],
        now: 15_000,
      });
    });
    await new ScheduleRepository(database).addVersion({
      commandId: 'schedule-water-v2',
      deviceId: 'device-a',
      issuedAt: 16_000,
      payload: {
        scheduleId: 'schedule-water',
        version: {
          effectiveFrom: '2026-09-01',
          ruleType: 'daily',
          rule: { label: 'Every day' },
          slots: [{ id: 'slot-water-v2', key: 'default', localTime: '09:00' }],
          goals: [
            {
              id: 'goal-water-v2',
              slotId: 'slot-water-v2',
              measurementType: 'quantity',
              targetValue: 2_500,
              unit: 'ml',
            },
          ],
        },
      },
    });
  }

  it('uploads on A and materializes every current aggregate on B without a new oplog', async () => {
    const transport = new SharedMemoryTransport();
    const a = await setupDatabase();
    const b = await setupDatabase();
    await seedCompleteGraph(a.database);

    expect(
      (await syncClient(a.database, 'device-a', transport).connect()).ok,
    ).toBe(true);
    const clientB = syncClient(b.database, 'device-b', transport);
    expect((await clientB.connect()).ok).toBe(true);
    await clientB.syncNow('manual');

    expect(
      b.adapter.native.prepare('SELECT count(*) AS count FROM items').get(),
    ).toEqual({
      count: 3,
    });
    expect(
      b.adapter.native
        .prepare("SELECT name FROM categories WHERE id = 'category-health'")
        .get(),
    ).toEqual({ name: 'Health' });
    expect(
      b.adapter.native.prepare('SELECT count(*) AS count FROM item_tags').get(),
    ).toEqual({
      count: 1,
    });
    expect(
      b.adapter.native
        .prepare(
          "SELECT timer_started_at FROM habits WHERE item_id = 'habit-water'",
        )
        .get(),
    ).toEqual({ timer_started_at: 15_000 });
    expect(
      b.adapter.native
        .prepare('SELECT count(*) AS count FROM measurements')
        .get(),
    ).toEqual({
      count: 1,
    });
    expect(
      b.adapter.native
        .prepare('SELECT count(*) AS count FROM occurrence_overrides')
        .get(),
    ).toEqual({ count: 1 });
    expect(
      b.adapter.native
        .prepare(
          "SELECT status FROM task_instances WHERE id = 'task-instance-shoes'",
        )
        .get(),
    ).toEqual({ status: 'completed' });
    expect(
      b.adapter.native
        .prepare(
          `SELECT completed FROM task_instance_subtasks
           WHERE task_instance_id = 'task-instance-shoes' AND subtask_id = 'subtask-laces'`,
        )
        .get(),
    ).toEqual({ completed: 1 });
    expect(
      b.adapter.native
        .prepare("SELECT status FROM routine_runs WHERE id = 'run-morning'")
        .get(),
    ).toEqual({ status: 'completed' });
    expect(
      b.adapter.native
        .prepare(
          `SELECT status FROM routine_run_steps
           WHERE routine_run_id = 'run-morning' AND step_id = 'step-water'`,
        )
        .get(),
    ).toEqual({ status: 'completed' });
    expect(
      b.adapter.native
        .prepare(
          "SELECT local_time FROM reminder_rules WHERE id = 'reminder-water'",
        )
        .get(),
    ).toEqual({ local_time: '08:00' });
    expect(
      b.adapter.native
        .prepare(
          "SELECT action FROM reminder_deliveries WHERE id = 'delivery-water'",
        )
        .get(),
    ).toEqual({ action: 'snooze' });
    expect(
      b.adapter.native
        .prepare(
          "SELECT count(*) AS count FROM schedule_versions WHERE schedule_id = 'schedule-water'",
        )
        .get(),
    ).toEqual({ count: 2 });
    expect(
      b.adapter.native
        .prepare('SELECT count(*) AS count FROM item_pauses')
        .get(),
    ).toEqual({
      count: 1,
    });
    expect(
      b.adapter.native.prepare('SELECT count(*) AS count FROM oplog').get(),
    ).toEqual({ count: 0 });
  });

  it('resolves concurrent dashboard writes with field LWW and converges both databases', async () => {
    const transport = new SharedMemoryTransport();
    const a = await setupDatabase();
    const b = await setupDatabase();
    const itemsA = new ItemRepository(a.database);
    await itemsA.createHabit({
      commandId: 'create-shared-habit',
      deviceId: 'device-a',
      issuedAt: 1_000,
      payload: {
        id: 'habit-shared',
        title: 'Shared',
        measurementType: 'boolean',
      },
    });
    const clientA = syncClient(a.database, 'device-a', transport);
    const clientB = syncClient(b.database, 'device-b', transport);
    await clientA.connect();
    await clientB.connect();

    await new ActionRepository(a.database).reorderDashboard({
      commandId: 'layout-older',
      deviceId: 'device-a',
      issuedAt: 60_000,
      payload: { entries: [{ itemId: 'habit-shared', sortOrder: 10 }] },
    });
    await new ActionRepository(b.database).reorderDashboard({
      commandId: 'layout-newer',
      deviceId: 'device-b',
      issuedAt: 70_000,
      payload: { entries: [{ itemId: 'habit-shared', sortOrder: 20 }] },
    });

    await clientA.syncNow('manual');
    await clientB.syncNow('manual');
    await clientA.syncNow('manual');

    const query =
      "SELECT sort_order FROM dashboard_layout WHERE workspace_id = 'local-personal' AND item_id = 'habit-shared'";
    expect(a.adapter.native.prepare(query).get()).toEqual({ sort_order: 20 });
    expect(b.adapter.native.prepare(query).get()).toEqual({ sort_order: 20 });
  });

  it('syncs a normalized definition edit and a reminder tombstone', async () => {
    const transport = new SharedMemoryTransport();
    const a = await setupDatabase();
    const b = await setupDatabase();
    let syncNow = 100_000;
    const before: HabitItem = {
      id: 'habit-edit',
      kind: 'habit',
      title: 'Agua',
      tags: [],
      schedule: {
        kind: 'daily',
        startDate: '2026-08-31',
        slots: [],
      },
      reminders: [
        {
          id: 'reminder-keep',
          time: '08:00',
          enabled: true,
          snoozeMinutes: 10,
        },
        {
          id: 'reminder-remove',
          time: '20:00',
          enabled: true,
          snoozeMinutes: 5,
        },
      ],
      scheduleLabel: 'Todos los días',
      reminderTime: '08:00',
      sortOrder: 0,
      metric: 'count',
      target: 8,
      unit: 'vasos',
      value: 0,
      completed: false,
      graceMinutes: 0,
      streak: 0,
    };
    const writerA = new AtlasSnapshotWriter(
      a.database,
      testGateway(a.database),
      'device-a',
      () => new Date(1_000),
    );
    await writerA.applyChanges(
      [{ kind: 'item.create', item: before }],
      snapshotWithHabit(before),
      '2026-08-31',
    );

    const clientA = syncClient(
      a.database,
      'device-a',
      transport,
      () => syncNow,
    );
    const clientB = syncClient(
      b.database,
      'device-b',
      transport,
      () => syncNow,
    );
    await clientA.connect();
    await clientB.connect();

    const after: HabitItem = {
      ...before,
      metric: 'duration',
      target: 900,
      unit: 'seconds',
      reminders: [
        {
          id: 'reminder-keep',
          time: '09:15',
          enabled: true,
          snoozeMinutes: 15,
        },
        {
          id: 'reminder-new',
          time: '18:30',
          enabled: false,
          snoozeMinutes: 20,
        },
      ],
      reminderTime: '09:15',
    };
    const editingWriterA = new AtlasSnapshotWriter(
      a.database,
      testGateway(a.database),
      'device-a',
      () => new Date(200_000),
    );
    await editingWriterA.applyChanges(
      [{ kind: 'item.definition', before, item: after }],
      snapshotWithHabit(after),
      '2026-08-31',
    );

    const itemMutation = a.adapter.native
      .prepare(
        `SELECT payload_json FROM oplog
         WHERE entity_type = 'item' AND entity_id = 'habit-edit'
         ORDER BY device_seq DESC LIMIT 1`,
      )
      .get() as { payload_json: string };
    expect(JSON.parse(itemMutation.payload_json)).toEqual({
      defaultValue: 900,
      id: 'habit-edit',
      measurementType: 'duration',
      type: 'habit',
      unit: 'seconds',
      updatedAt: 200_000,
    });
    const reminderMutations = a.adapter.native
      .prepare(
        `SELECT entity_id, operation, payload_json FROM oplog
         WHERE entity_type = 'reminder_rule'
         ORDER BY device_seq`,
      )
      .all() as {
      entity_id: string;
      operation: 'upsert' | 'delete';
      payload_json: string;
    }[];
    expect(
      reminderMutations.find(
        (mutation) =>
          mutation.entity_id === 'reminder-remove' &&
          mutation.operation === 'delete',
      ),
    ).toBeDefined();
    expect(
      JSON.parse(
        reminderMutations.find(
          (mutation) =>
            mutation.entity_id === 'reminder-keep' &&
            mutation.operation === 'upsert' &&
            JSON.parse(mutation.payload_json).localTime === '09:15',
        )?.payload_json ?? '{}',
      ),
    ).toMatchObject({
      id: 'reminder-keep',
      itemId: 'habit-edit',
      localTime: '09:15',
      snoozeMinutes: 15,
      triggerType: 'scheduled',
      exactAlarm: true,
      allowComplete: true,
      allowSnooze: true,
    });
    expect(
      a.adapter.native
        .prepare(
          `SELECT entity_type, entity_id FROM tombstones
           WHERE entity_type = 'reminder_rule' AND entity_id = 'reminder-remove'`,
        )
        .get(),
    ).toEqual({
      entity_type: 'reminder_rule',
      entity_id: 'reminder-remove',
    });

    syncNow = 300_000;
    await clientA.syncNow('manual');
    await clientB.syncNow('manual');

    expect(
      b.adapter.native
        .prepare(
          `SELECT measurement_type, unit, default_value FROM habits
           WHERE item_id = 'habit-edit'`,
        )
        .get(),
    ).toEqual({
      measurement_type: 'duration',
      unit: 'seconds',
      default_value: 900,
    });
    expect(
      b.adapter.native
        .prepare(
          `SELECT enabled, local_time, snooze_minutes, deleted_at
           FROM reminder_rules WHERE id = 'reminder-keep'`,
        )
        .get(),
    ).toEqual({
      enabled: 1,
      local_time: '09:15',
      snooze_minutes: 15,
      deleted_at: null,
    });
    const removedReminder = b.adapter.native
      .prepare(
        `SELECT enabled, deleted_at FROM reminder_rules
         WHERE id = 'reminder-remove'`,
      )
      .get() as { enabled: number; deleted_at: number | null };
    expect(removedReminder.enabled).toBe(0);
    expect(removedReminder.deleted_at).not.toBeNull();
    expect(
      b.adapter.native
        .prepare(
          `SELECT enabled, local_time, snooze_minutes, deleted_at
           FROM reminder_rules WHERE id = 'reminder-new'`,
        )
        .get(),
    ).toEqual({
      enabled: 0,
      local_time: '18:30',
      snooze_minutes: 20,
      deleted_at: null,
    });
    expect(
      b.adapter.native.prepare('SELECT count(*) AS count FROM oplog').get(),
    ).toEqual({ count: 0 });
  });

  it('replays downloaded history idempotently from receipts after a cursor reset', async () => {
    const transport = new SharedMemoryTransport();
    const a = await setupDatabase();
    const b = await setupDatabase();
    await new ItemRepository(a.database).createHabit({
      commandId: 'create-replay-habit',
      deviceId: 'device-a',
      issuedAt: 1_000,
      payload: {
        id: 'habit-replay',
        title: 'Replay',
        measurementType: 'boolean',
      },
    });
    const clientA = syncClient(a.database, 'device-a', transport);
    const clientB = syncClient(b.database, 'device-b', transport);
    await clientA.connect();
    await clientB.connect();

    const receiptsBefore = b.adapter.native
      .prepare('SELECT count(*) AS count FROM sync_applied_mutations')
      .get();
    b.adapter.native.exec(
      `UPDATE sync_cursors
       SET pull_cursor = NULL
       WHERE workspace_id = 'local-personal' AND remote_name = 'test-remote'`,
    );
    const replay = await clientB.syncNow('manual');

    expect(replay.duplicateMutations).toBeGreaterThan(0);
    expect(
      b.adapter.native.prepare('SELECT count(*) AS count FROM items').get(),
    ).toEqual({
      count: 1,
    });
    expect(
      b.adapter.native
        .prepare('SELECT count(*) AS count FROM sync_applied_mutations')
        .get(),
    ).toEqual(receiptsBefore);
  });
});
