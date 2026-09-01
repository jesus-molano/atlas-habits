import type { SQLiteDatabase } from 'expo-sqlite';

import type { CommandGateway } from '../data/command-gateway';
import { executeIdempotentCommand } from '../data/idempotency';
import { assertLocalDate } from '../data/local-date';
import { recordMutation } from '../data/oplog';
import { LOCAL_WORKSPACE_ID, type ScheduleVersionInput } from '../data/types';
import { createUuid } from '../data/uuid';
import {
  expectedCompletions,
  normalizeSchedule,
} from '../features/atlas/schedule';
import type {
  AtlasItem,
  AtlasSnapshot,
  HabitItem,
  Priority,
  RoutineItem,
  TaskItem,
} from '../features/atlas/types';

import {
  localDateFromDate,
  normalizeReminderTime,
  occurrenceKeyForItem,
  timestampFromUiValue,
} from './date-time';
import type { AtlasSnapshotChange } from './snapshot-diff';

type MetadataIds = Readonly<{
  categoryId: string | null;
  tagIds: readonly string[];
}>;

type RoutineRunRow = Readonly<{
  id: string;
  status: 'running' | 'completed' | 'abandoned';
}>;

function commandId(kind: string): string {
  return `app:${kind}:${createUuid()}`;
}

function priorityNumber(priority: Priority): 1 | 2 | 3 {
  return priority === 'high' ? 3 : priority === 'medium' ? 2 : 1;
}

function measurementType(
  habit: HabitItem,
): 'boolean' | 'quantity' | 'duration' {
  return habit.metric === 'count' ? 'quantity' : habit.metric;
}

function timezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function createSchedule(
  item: AtlasItem,
  _today: string,
): ScheduleVersionInput & { timezone: string } {
  const schedule = normalizeSchedule(item.schedule);
  assertLocalDate(schedule.startDate);
  const common = {
    effectiveFrom: schedule.startDate,
    timezone: timezone(),
    graceMinutes: item.kind === 'habit' ? (item.graceMinutes ?? 0) : 0,
    slots: schedule.slots.map((slot, index) => ({
      key: slot.id,
      label: slot.label ?? null,
      localTime: normalizeReminderTime(slot.time) ?? null,
      sortOrder: index,
    })),
  } as const;

  let rule: Pick<ScheduleVersionInput, 'ruleType' | 'rule'>;
  switch (schedule.kind) {
    case 'once':
      rule = { ruleType: 'once', rule: { date: schedule.date } };
      break;
    case 'daily':
      rule = { ruleType: 'daily', rule: {} };
      break;
    case 'weekdays':
      rule = { ruleType: 'weekdays', rule: { days: schedule.days } };
      break;
    case 'interval_days':
      rule = {
        ruleType: 'interval',
        rule: { every: schedule.every, anchorDate: schedule.anchorDate },
      };
      break;
    case 'period_quota':
      rule = {
        ruleType: 'period_quota',
        rule: {
          quota: schedule.quota,
          period: schedule.period,
          weekStartsOn: schedule.weekStartsOn,
        },
      };
      break;
  }

  return {
    ...common,
    ...rule,
    goals:
      item.kind === 'habit'
        ? [
            {
              measurementType: measurementType(item),
              aggregation: item.metric === 'duration' ? 'duration' : 'sum',
              comparison: 'at_least',
              targetValue:
                item.metric === 'boolean'
                  ? expectedCompletions(schedule)
                  : Math.max(1, item.target),
              unit:
                item.unit || (item.metric === 'duration' ? 'seconds' : 'vez'),
            },
          ]
        : [],
  };
}

async function ensureCategory(
  database: SQLiteDatabase,
  deviceId: string,
  category: string | undefined,
  now: number,
): Promise<string | null> {
  const name = category?.trim();
  if (!name) return null;
  const existing = await database.getFirstAsync<{ id: string }>(
    `SELECT id FROM categories
     WHERE workspace_id = ? AND name = ? COLLATE NOCASE AND deleted_at IS NULL`,
    [LOCAL_WORKSPACE_ID, name],
  );
  if (existing) return existing.id;

  const id = createUuid();
  const result = await executeIdempotentCommand(
    database,
    {
      id: commandId('category.create'),
      name: 'application.category.create',
      payload: { id, name },
      issuedAt: now,
    },
    async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO categories
          (id, workspace_id, name, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`,
        [id, LOCAL_WORKSPACE_ID, name, now, now],
      );
      await recordMutation(transaction, {
        commandId: `category:${id}`,
        deviceId,
        entityType: 'category',
        entityId: id,
        operation: 'upsert',
        payload: { id, name },
        now,
      });
      return { id };
    },
  );
  return result.value.id;
}

async function ensureTag(
  database: SQLiteDatabase,
  deviceId: string,
  rawName: string,
  now: number,
): Promise<string | null> {
  const name = rawName.trim();
  if (!name) return null;
  const existing = await database.getFirstAsync<{ id: string }>(
    `SELECT id FROM tags
     WHERE workspace_id = ? AND name = ? COLLATE NOCASE AND deleted_at IS NULL`,
    [LOCAL_WORKSPACE_ID, name],
  );
  if (existing) return existing.id;

  const id = createUuid();
  const result = await executeIdempotentCommand(
    database,
    {
      id: commandId('tag.create'),
      name: 'application.tag.create',
      payload: { id, name },
      issuedAt: now,
    },
    async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO tags
          (id, workspace_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [id, LOCAL_WORKSPACE_ID, name, now, now],
      );
      await recordMutation(transaction, {
        commandId: `tag:${id}`,
        deviceId,
        entityType: 'tag',
        entityId: id,
        operation: 'upsert',
        payload: { id, name },
        now,
      });
      return { id };
    },
  );
  return result.value.id;
}

async function ensureMetadata(
  database: SQLiteDatabase,
  deviceId: string,
  item: AtlasItem,
  now: number,
): Promise<MetadataIds> {
  const categoryId = await ensureCategory(
    database,
    deviceId,
    item.category,
    now,
  );
  const tagIds = (
    await Promise.all(
      [...new Set(item.tags)].map((tag) =>
        ensureTag(database, deviceId, tag, now),
      ),
    )
  ).filter((id): id is string => id !== null);
  return { categoryId, tagIds };
}

async function updateMetadata(
  database: SQLiteDatabase,
  deviceId: string,
  item: AtlasItem,
  metadata: MetadataIds,
  now: number,
): Promise<void> {
  const payload = {
    itemId: item.id,
    title: item.title.trim(),
    notes: item.notes?.trim() || null,
    categoryId: metadata.categoryId,
    tagIds: metadata.tagIds,
    sortOrder: item.sortOrder,
    updatedAt: now,
  };
  await executeIdempotentCommand(
    database,
    {
      id: commandId('item.metadata'),
      name: 'application.item.metadata',
      payload,
      issuedAt: now,
    },
    async (transaction) => {
      const result = await transaction.runAsync(
        `UPDATE items SET title = ?, notes = ?, category_id = ?, sort_order = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [
          payload.title,
          payload.notes,
          payload.categoryId,
          payload.sortOrder,
          now,
          item.id,
        ],
      );
      if (result.changes !== 1)
        throw new Error(`Item ${item.id} does not exist.`);
      await transaction.runAsync('DELETE FROM item_tags WHERE item_id = ?', [
        item.id,
      ]);
      for (const tagId of metadata.tagIds) {
        await transaction.runAsync(
          'INSERT INTO item_tags (item_id, tag_id, created_at) VALUES (?, ?, ?)',
          [item.id, tagId, now],
        );
      }
      await recordMutation(transaction, {
        commandId: `metadata:${item.id}:${now}`,
        deviceId,
        entityType: 'item',
        entityId: item.id,
        operation: 'upsert',
        payload,
        changedFields: ['title', 'notes', 'categoryId', 'tagIds', 'sortOrder'],
        now,
      });
      return { itemId: item.id };
    },
  );
}

async function setHabitTimer(
  database: SQLiteDatabase,
  deviceId: string,
  habitId: string,
  startedAt: number | null,
  now: number,
): Promise<void> {
  const payload = { timerStartedAt: startedAt, updatedAt: now };
  await executeIdempotentCommand(
    database,
    {
      id: commandId('habit.timer'),
      name: 'application.habit.timer',
      payload,
      issuedAt: now,
    },
    async (transaction) => {
      const result = await transaction.runAsync(
        'UPDATE habits SET timer_started_at = ? WHERE item_id = ?',
        [startedAt, habitId],
      );
      if (result.changes !== 1)
        throw new Error(`Habit ${habitId} does not exist.`);
      await transaction.runAsync(
        'UPDATE items SET updated_at = ? WHERE id = ?',
        [now, habitId],
      );
      await recordMutation(transaction, {
        commandId: `timer:${habitId}:${now}`,
        deviceId,
        entityType: 'habit',
        entityId: habitId,
        operation: 'upsert',
        payload,
        changedFields: ['timerStartedAt'],
        now,
      });
      return { habitId, startedAt };
    },
  );
}

async function setTaskSubtask(
  database: SQLiteDatabase,
  deviceId: string,
  taskInstanceId: string,
  subtaskId: string,
  completed: boolean,
  now: number,
): Promise<void> {
  const payload = { taskInstanceId, subtaskId, completed, updatedAt: now };
  await executeIdempotentCommand(
    database,
    {
      id: commandId('task.subtask'),
      name: 'application.task.subtask',
      payload,
      issuedAt: now,
    },
    async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO task_instance_subtasks
          (task_instance_id, subtask_id, completed, completed_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(task_instance_id, subtask_id) DO UPDATE SET
           completed = excluded.completed,
           completed_at = excluded.completed_at,
           updated_at = excluded.updated_at`,
        [
          taskInstanceId,
          subtaskId,
          completed ? 1 : 0,
          completed ? now : null,
          now,
        ],
      );
      const entityId = `${taskInstanceId}:${subtaskId}`;
      await recordMutation(transaction, {
        commandId: `subtask:${entityId}:${now}`,
        deviceId,
        entityType: 'task_instance_subtask',
        entityId,
        operation: 'upsert',
        payload,
        now,
      });
      return { entityId };
    },
  );
}

async function findRoutineRun(
  database: SQLiteDatabase,
  routineId: string,
  localDate: string,
): Promise<RoutineRunRow | null> {
  return database.getFirstAsync<RoutineRunRow>(
    `SELECT id, status FROM routine_runs
     WHERE routine_id = ? AND local_date = ?
     ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, started_at DESC
     LIMIT 1`,
    [routineId, localDate],
  );
}

async function reopenRoutineRun(
  database: SQLiteDatabase,
  deviceId: string,
  runId: string,
  now: number,
): Promise<void> {
  const payload = {
    runId,
    status: 'running' as const,
    startedAt: now,
    finishedAt: null,
    resetSteps: true,
    updatedAt: now,
  };
  await executeIdempotentCommand(
    database,
    {
      id: commandId('routine.reopen'),
      name: 'application.routine.reopen',
      payload,
      issuedAt: now,
    },
    async (transaction) => {
      await transaction.runAsync(
        `UPDATE routine_runs
         SET status = 'running', started_at = ?, finished_at = NULL, updated_at = ?
         WHERE id = ?`,
        [now, now, runId],
      );
      await transaction.runAsync(
        `UPDATE routine_run_steps
         SET status = 'pending', started_at = NULL, finished_at = NULL,
             elapsed_seconds = 0, updated_at = ?
         WHERE routine_run_id = ?`,
        [now, runId],
      );
      await recordMutation(transaction, {
        commandId: `routine-reopen:${runId}:${now}`,
        deviceId,
        entityType: 'routine_run',
        entityId: runId,
        operation: 'upsert',
        payload,
        changedFields: ['status', 'startedAt', 'finishedAt', 'resetSteps'],
        now,
      });
      return { runId };
    },
  );
}

async function resetRoutineRun(
  database: SQLiteDatabase,
  deviceId: string,
  runId: string,
  now: number,
): Promise<void> {
  const payload = {
    runId,
    status: 'abandoned' as const,
    finishedAt: now,
    resetSteps: true,
    updatedAt: now,
  };
  await executeIdempotentCommand(
    database,
    {
      id: commandId('routine.reset'),
      name: 'application.routine.reset',
      payload,
      issuedAt: now,
    },
    async (transaction) => {
      await transaction.runAsync(
        `UPDATE routine_runs SET status = 'abandoned', finished_at = ?, updated_at = ?
         WHERE id = ?`,
        [now, now, runId],
      );
      await transaction.runAsync(
        `UPDATE routine_run_steps
         SET status = 'pending', started_at = NULL, finished_at = NULL,
             elapsed_seconds = 0, updated_at = ?
         WHERE routine_run_id = ?`,
        [now, runId],
      );
      await recordMutation(transaction, {
        commandId: `routine-reset:${runId}:${now}`,
        deviceId,
        entityType: 'routine_run',
        entityId: runId,
        operation: 'upsert',
        payload,
        changedFields: ['status', 'finishedAt', 'resetSteps'],
        now,
      });
      return { runId };
    },
  );
}

function scheduleDefinition(item: AtlasItem): string {
  return JSON.stringify({
    schedule: item.schedule,
    reminders: item.reminders,
    graceMinutes: item.kind === 'habit' ? (item.graceMinutes ?? 0) : 0,
    target: item.kind === 'habit' ? item.target : null,
    metric: item.kind === 'habit' ? item.metric : null,
    unit: item.kind === 'habit' ? item.unit : null,
  });
}

function definitionMutation(item: AtlasItem, localDate: string, now: number) {
  const common = {
    id: item.id,
    type: item.kind,
    updatedAt: now,
  } as const;

  if (item.kind === 'habit') {
    return {
      payload: {
        ...common,
        measurementType: measurementType(item),
        unit: item.unit || null,
        defaultValue: Math.max(1, item.target),
      },
      changedFields: [
        'id',
        'type',
        'updatedAt',
        'measurementType',
        'unit',
        'defaultValue',
      ],
    } as const;
  }

  if (item.kind === 'task') {
    const dueAt = timestampFromUiValue(
      item.dueAt,
      localDate as `${number}-${number}-${number}`,
    );
    return {
      payload: {
        ...common,
        priority: priorityNumber(item.priority),
        allDay: dueAt === null,
        dueAt,
        deadlineAt: timestampFromUiValue(
          item.deadlineAt,
          localDate as `${number}-${number}-${number}`,
        ),
        subtasks: item.subtasks.map((subtask, index) => ({
          id: subtask.id,
          title: subtask.title.trim(),
          sortOrder: index,
          required: subtask.required,
        })),
      },
      changedFields: [
        'id',
        'type',
        'updatedAt',
        'priority',
        'allDay',
        'dueAt',
        'deadlineAt',
        'subtasks',
      ],
    } as const;
  }

  return {
    payload: {
      ...common,
      completionPolicy: 'all_required',
      steps: item.steps.map((step, index) => ({
        id: step.id,
        title: step.title.trim(),
        notes: null,
        sortOrder: index,
        required: step.required,
        durationSeconds: step.durationSeconds ?? null,
      })),
    },
    changedFields: ['id', 'type', 'updatedAt', 'completionPolicy', 'steps'],
  } as const;
}

function normalizedReminderMutation(
  itemId: string,
  reminder: AtlasItem['reminders'][number],
  localTime: string,
  now: number,
) {
  return {
    id: reminder.id,
    itemId,
    scheduleSlotId: null,
    enabled: reminder.enabled,
    triggerType: 'scheduled',
    localTime,
    offsetMinutes: 0,
    exactAlarm: reminder.exactAlarm ?? true,
    allowComplete: true,
    allowSnooze: true,
    snoozeMinutes: reminder.snoozeMinutes,
    repeatUntilCompleted: false,
    repeatIntervalMinutes: null,
    androidNotificationKey: null,
    updatedAt: now,
  } as const;
}

async function updateItemDefinition(
  database: SQLiteDatabase,
  gateway: CommandGateway,
  deviceId: string,
  before: AtlasItem,
  item: AtlasItem,
  localDate: string,
  now: number,
): Promise<void> {
  if (before.kind !== item.kind)
    throw new Error('Item kind cannot change in place.');

  await executeIdempotentCommand(
    database,
    {
      id: commandId('item.definition'),
      name: 'application.item.definition',
      payload: { before, item, localDate },
      issuedAt: now,
    },
    async (transaction) => {
      const mutation = definitionMutation(item, localDate, now);
      if (item.kind === 'habit') {
        await transaction.runAsync(
          `UPDATE habits
           SET measurement_type = ?, unit = ?, default_value = ?
           WHERE item_id = ?`,
          [
            measurementType(item),
            item.unit || null,
            Math.max(1, item.target),
            item.id,
          ],
        );
      } else if (item.kind === 'task') {
        const dueAt = timestampFromUiValue(
          item.dueAt,
          localDate as `${number}-${number}-${number}`,
        );
        const deadlineAt = timestampFromUiValue(
          item.deadlineAt,
          localDate as `${number}-${number}-${number}`,
        );
        await transaction.runAsync(
          `UPDATE tasks
           SET priority = ?, all_day = ?, due_at = ?, deadline_at = ?
           WHERE item_id = ?`,
          [
            priorityNumber(item.priority),
            dueAt === null ? 1 : 0,
            dueAt,
            deadlineAt,
            item.id,
          ],
        );
        await transaction.runAsync(
          'UPDATE task_subtasks SET deleted_at = ?, updated_at = ? WHERE task_id = ?',
          [now, now, item.id],
        );
        for (const [index, subtask] of item.subtasks.entries()) {
          await transaction.runAsync(
            `INSERT INTO task_subtasks
              (id, task_id, title, sort_order, required, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title,
               sort_order = excluded.sort_order,
               required = excluded.required,
               updated_at = excluded.updated_at,
               deleted_at = NULL`,
            [
              subtask.id,
              item.id,
              subtask.title.trim(),
              index,
              subtask.required ? 1 : 0,
              now,
              now,
            ],
          );
        }
      } else {
        await transaction.runAsync(
          'UPDATE routine_steps SET deleted_at = ?, updated_at = ? WHERE routine_id = ?',
          [now, now, item.id],
        );
        for (const [index, step] of item.steps.entries()) {
          await transaction.runAsync(
            `INSERT INTO routine_steps
              (id, routine_id, title, sort_order, required, duration_seconds,
               created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title,
               sort_order = excluded.sort_order,
               required = excluded.required,
               duration_seconds = excluded.duration_seconds,
               updated_at = excluded.updated_at,
               deleted_at = NULL`,
            [
              step.id,
              item.id,
              step.title.trim(),
              index,
              step.required ? 1 : 0,
              step.durationSeconds ?? null,
              now,
              now,
            ],
          );
        }
      }

      const existingReminders = await transaction.getAllAsync<{ id: string }>(
        `SELECT id FROM reminder_rules
         WHERE item_id = ? AND deleted_at IS NULL`,
        [item.id],
      );
      const reminders = item.reminders.flatMap((reminder) => {
        const localTime = normalizeReminderTime(reminder.time);
        return localTime ? [{ reminder, localTime }] : [];
      });
      const retainedIds = new Set(reminders.map(({ reminder }) => reminder.id));
      for (const { id } of existingReminders) {
        if (retainedIds.has(id)) continue;
        await transaction.runAsync(
          `UPDATE reminder_rules
           SET enabled = 0, deleted_at = ?, updated_at = ?
           WHERE id = ?`,
          [now, now, id],
        );
        await recordMutation(transaction, {
          commandId: `definition:${item.id}:reminder-delete:${id}:${now}`,
          deviceId,
          entityType: 'reminder_rule',
          entityId: id,
          operation: 'delete',
          payload: { id, itemId: item.id, deletedAt: now },
          now,
        });
      }
      for (const { reminder, localTime } of reminders) {
        const reminderPayload = normalizedReminderMutation(
          item.id,
          reminder,
          localTime,
          now,
        );
        await transaction.runAsync(
          `INSERT INTO reminder_rules
            (id, item_id, schedule_slot_id, enabled, trigger_type, local_time,
             offset_minutes, exact_alarm, allow_complete, allow_snooze,
             snooze_minutes, repeat_until_completed, repeat_interval_minutes,
             android_notification_key, created_at, updated_at, deleted_at)
           VALUES (?, ?, NULL, ?, 'scheduled', ?, 0, 1, 1, 1, ?, 0, NULL, NULL, ?, ?, NULL)
           ON CONFLICT(id) DO UPDATE SET
             item_id = excluded.item_id,
             schedule_slot_id = excluded.schedule_slot_id,
             enabled = excluded.enabled,
             trigger_type = excluded.trigger_type,
             local_time = excluded.local_time,
             offset_minutes = excluded.offset_minutes,
             exact_alarm = excluded.exact_alarm,
             allow_complete = excluded.allow_complete,
             allow_snooze = excluded.allow_snooze,
             snooze_minutes = excluded.snooze_minutes,
             repeat_until_completed = excluded.repeat_until_completed,
             repeat_interval_minutes = excluded.repeat_interval_minutes,
             android_notification_key = excluded.android_notification_key,
             updated_at = excluded.updated_at,
             deleted_at = NULL`,
          [
            reminderPayload.id,
            reminderPayload.itemId,
            reminderPayload.enabled ? 1 : 0,
            reminderPayload.localTime,
            reminderPayload.snoozeMinutes,
            now,
            now,
          ],
        );
        await recordMutation(transaction, {
          commandId: `definition:${item.id}:reminder-upsert:${reminder.id}:${now}`,
          deviceId,
          entityType: 'reminder_rule',
          entityId: reminder.id,
          operation: 'upsert',
          payload: reminderPayload,
          now,
        });
      }
      await transaction.runAsync(
        'UPDATE items SET updated_at = ? WHERE id = ?',
        [now, item.id],
      );
      await recordMutation(transaction, {
        commandId: `definition:${item.id}:${now}`,
        deviceId,
        entityType: 'item',
        entityId: item.id,
        operation: 'upsert',
        payload: mutation.payload,
        changedFields: mutation.changedFields,
        now,
      });
      return { itemId: item.id };
    },
  );

  if (scheduleDefinition(before) !== scheduleDefinition(item)) {
    const schedule = await database.getFirstAsync<{ id: string }>(
      'SELECT id FROM schedules WHERE item_id = ? AND retired_at IS NULL LIMIT 1',
      [item.id],
    );
    if (!schedule) throw new Error(`Schedule for ${item.id} does not exist.`);
    const requestedVersion = createSchedule(item, localDate);
    const version = {
      ...requestedVersion,
      // Editing an already-active definition creates a new civil-date
      // boundary. A same-day edit amends the unelapsed head in the repository.
      effectiveFrom:
        requestedVersion.effectiveFrom < localDate
          ? localDate
          : requestedVersion.effectiveFrom,
    };
    await gateway.schedules.addVersion({
      commandId: commandId('schedule.version'),
      deviceId,
      issuedAt: now,
      payload: {
        scheduleId: schedule.id,
        version,
        createdAt: now,
      },
    });
  }
}

export class AtlasSnapshotWriter {
  constructor(
    private readonly database: SQLiteDatabase,
    private readonly gateway: CommandGateway,
    private readonly deviceId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async createItem(item: AtlasItem, localDate: string): Promise<void> {
    const now = this.now().getTime();
    const metadata = await ensureMetadata(
      this.database,
      this.deviceId,
      item,
      now,
    );
    const envelope = {
      commandId: commandId(`create.${item.kind}`),
      deviceId: this.deviceId,
      issuedAt: now,
    };
    const common = {
      id: item.id,
      title: item.title,
      notes: item.notes ?? null,
      categoryId: metadata.categoryId,
      tagIds: [...metadata.tagIds],
      sortOrder: item.sortOrder,
      createdAt: now,
      schedule: createSchedule(item, localDate),
    };

    let result: Awaited<ReturnType<CommandGateway['items']['createHabit']>>;
    if (item.kind === 'habit') {
      result = await this.gateway.items.createHabit({
        ...envelope,
        payload: {
          ...common,
          measurementType: measurementType(item),
          unit: item.unit || null,
          defaultValue:
            item.metric === 'count' ? 1 : item.metric === 'duration' ? 60 : 1,
        },
      });
    } else if (item.kind === 'task') {
      result = await this.gateway.items.createTask({
        ...envelope,
        payload: {
          ...common,
          priority: priorityNumber(item.priority),
          allDay: !item.dueAt,
          dueAt: timestampFromUiValue(
            item.dueAt,
            localDate as `${number}-${number}-${number}`,
          ),
          deadlineAt: timestampFromUiValue(
            item.deadlineAt,
            localDate as `${number}-${number}-${number}`,
          ),
          subtasks: item.subtasks.map((subtask, index) => ({
            id: subtask.id,
            title: subtask.title,
            sortOrder: index,
            required: subtask.required,
          })),
        },
      });
    } else {
      result = await this.gateway.items.createRoutine({
        ...envelope,
        payload: {
          ...common,
          completionPolicy: 'all_required',
          steps: item.steps.map((step, index) => ({
            id: step.id,
            title: step.title,
            sortOrder: index,
            required: step.required,
            durationSeconds: step.durationSeconds ?? null,
          })),
        },
      });
    }

    for (const reminder of item.reminders) {
      const localTime = normalizeReminderTime(reminder.time);
      if (!localTime) continue;
      await this.gateway.actions.upsertReminderRule({
        commandId: commandId('reminder.create'),
        deviceId: this.deviceId,
        issuedAt: now,
        payload: {
          id: reminder.id,
          itemId: item.id,
          scheduleSlotId: null,
          enabled: reminder.enabled,
          localTime,
          exactAlarm: reminder.exactAlarm ?? true,
          allowComplete: true,
          allowSnooze: true,
          snoozeMinutes: reminder.snoozeMinutes,
          updatedAt: now,
        },
      });
    }

    void result;
  }

  private async setHabitProgress(
    change: Extract<AtlasSnapshotChange, { kind: 'habit.progress' }>,
  ): Promise<void> {
    assertLocalDate(change.localDate);
    const now = this.now().getTime();
    const baseOccurrenceKey = occurrenceKeyForItem(
      'habit',
      change.habit.id,
      change.localDate as `${number}-${number}-${number}`,
    );
    const isPeriodQuota = change.habit.schedule.kind === 'period_quota';
    const contributions = isPeriodQuota
      ? change.habit.metric === 'boolean'
        ? Array.from({ length: Math.max(0, Math.round(change.value)) }, () => 1)
        : change.value > 0
          ? [change.value]
          : []
      : [change.value];
    for (const value of contributions) {
      const measurementCommandId = commandId('habit.progress');
      const sessionId = isPeriodQuota ? measurementCommandId : null;
      const occurrenceKey = isPeriodQuota
        ? `atlas:v1:habit:${encodeURIComponent(change.habit.id)}:quota:app:${encodeURIComponent(measurementCommandId)}:${change.localDate}`
        : baseOccurrenceKey;
      await this.gateway.progress.recordMeasurement({
        commandId: measurementCommandId,
        deviceId: this.deviceId,
        issuedAt: now,
        payload: {
          itemId: change.habit.id,
          occurrenceKey,
          sessionId,
          value,
          operation: isPeriodQuota ? 'add' : 'set',
          unit: change.habit.unit,
          occurredAt: now,
          localDate: change.localDate,
          source:
            change.before.value !== change.value &&
            change.habit.metric === 'duration'
              ? 'timer'
              : 'app',
        },
      });
    }
    await this.gateway.progress.setOccurrenceOverride({
      commandId: commandId('habit.override'),
      deviceId: this.deviceId,
      issuedAt: now,
      payload: {
        itemId: change.habit.id,
        occurrenceKey: baseOccurrenceKey,
        localDate: change.localDate,
        state: change.skipped ? 'excused' : 'reset',
        value: change.value,
        updatedAt: now,
      },
    });
  }

  private async setHabitPause(
    change: Extract<AtlasSnapshotChange, { kind: 'habit.pause' }>,
    localDate: string,
  ): Promise<void> {
    assertLocalDate(localDate);
    if (change.pauseUntil) assertLocalDate(change.pauseUntil);
    const active = await this.database.getFirstAsync<{
      id: string;
      end_date: string | null;
    }>(
      `SELECT id, end_date FROM item_pauses
       WHERE item_id = ? AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)
       ORDER BY start_date DESC LIMIT 1`,
      [change.habitId, localDate, localDate],
    );
    if (!change.paused) {
      if (!active) return;
      await this.gateway.actions.resumeItem({
        commandId: commandId('habit.resume'),
        deviceId: this.deviceId,
        payload: {
          pauseId: active.id,
          itemId: change.habitId,
          resumeOn: localDate,
          updatedAt: this.now().getTime(),
        },
      });
      return;
    }
    if (active?.end_date === change.pauseUntil) return;
    if (active) {
      await this.gateway.actions.resumeItem({
        commandId: commandId('habit.resume-before-repause'),
        deviceId: this.deviceId,
        payload: {
          pauseId: active.id,
          itemId: change.habitId,
          resumeOn: localDate,
          updatedAt: this.now().getTime(),
        },
      });
    }
    await this.gateway.actions.pauseItem({
      commandId: commandId('habit.pause'),
      deviceId: this.deviceId,
      payload: {
        itemId: change.habitId,
        startDate: localDate,
        endDate: change.pauseUntil,
        reason: 'Pausa creada desde Atlas',
        createdAt: this.now().getTime(),
      },
    });
  }

  private async setTaskStatus(
    task: TaskItem,
    completed: boolean,
    localDate: string,
  ): Promise<string> {
    assertLocalDate(localDate);
    const now = this.now().getTime();
    const result = await this.gateway.progress.setTaskInstanceStatus({
      commandId: commandId('task.status'),
      deviceId: this.deviceId,
      issuedAt: now,
      payload: {
        taskId: task.id,
        occurrenceKey: occurrenceKeyForItem(
          'task',
          task.id,
          localDate as `${number}-${number}-${number}`,
        ),
        localDate,
        dueAt: timestampFromUiValue(
          task.occurrenceDueAt ?? task.dueAt,
          localDate as `${number}-${number}-${number}`,
        ),
        deadlineAt: timestampFromUiValue(
          task.occurrenceDeadlineAt ?? task.deadlineAt,
          localDate as `${number}-${number}-${number}`,
        ),
        status: completed ? 'completed' : 'pending',
        updatedAt: now,
      },
    });
    return result.value.taskInstanceId;
  }

  private async ensureRoutineRun(
    routine: RoutineItem,
    localDate: string,
  ): Promise<RoutineRunRow> {
    const existing = await findRoutineRun(this.database, routine.id, localDate);
    if (existing?.status === 'running') return existing;
    const now = this.now().getTime();
    if (existing) {
      await reopenRoutineRun(this.database, this.deviceId, existing.id, now);
      return { id: existing.id, status: 'running' };
    }
    const result = await this.gateway.actions.startRoutineRun({
      commandId: commandId('routine.start'),
      deviceId: this.deviceId,
      issuedAt: now,
      payload: {
        routineId: routine.id,
        occurrenceKey: occurrenceKeyForItem(
          'routine',
          routine.id,
          localDate as `${number}-${number}-${number}`,
        ),
        localDate,
        startedAt: now,
      },
    });
    return { id: result.value.routineRunId, status: 'running' };
  }

  async applyChanges(
    changes: readonly AtlasSnapshotChange[],
    snapshot: AtlasSnapshot,
    localDate = localDateFromDate(this.now()),
  ): Promise<void> {
    assertLocalDate(localDate);
    for (const change of changes) {
      switch (change.kind) {
        case 'item.create':
          await this.createItem(change.item, localDate);
          break;
        case 'item.delete':
          await this.gateway.items.deleteItem({
            commandId: commandId('item.delete'),
            deviceId: this.deviceId,
            payload: { itemId: change.itemId, deletedAt: this.now().getTime() },
          });
          break;
        case 'item.metadata': {
          const now = this.now().getTime();
          const metadata = await ensureMetadata(
            this.database,
            this.deviceId,
            change.item,
            now,
          );
          await updateMetadata(
            this.database,
            this.deviceId,
            change.item,
            metadata,
            now,
          );
          break;
        }
        case 'item.definition':
          await updateItemDefinition(
            this.database,
            this.gateway,
            this.deviceId,
            change.before,
            change.item,
            localDate,
            this.now().getTime(),
          );
          break;
        case 'habit.progress':
          await this.setHabitProgress(change);
          break;
        case 'habit.timer':
          await setHabitTimer(
            this.database,
            this.deviceId,
            change.habitId,
            change.startedAt,
            this.now().getTime(),
          );
          break;
        case 'habit.pause':
          await this.setHabitPause(change, localDate);
          break;
        case 'task.status':
          await this.setTaskStatus(change.task, change.completed, localDate);
          break;
        case 'task.subtask': {
          const existing = await this.database.getFirstAsync<{ id: string }>(
            'SELECT id FROM task_instances WHERE task_id = ? AND local_date = ? LIMIT 1',
            [change.task.id, localDate],
          );
          const taskInstanceId =
            existing?.id ??
            (await this.setTaskStatus(
              change.task,
              change.task.completed,
              localDate,
            ));
          await setTaskSubtask(
            this.database,
            this.deviceId,
            taskInstanceId,
            change.subtaskId,
            change.completed,
            this.now().getTime(),
          );
          break;
        }
        case 'routine.start':
          await this.ensureRoutineRun(change.routine, localDate);
          break;
        case 'routine.step': {
          const run = await this.ensureRoutineRun(change.routine, localDate);
          const now = this.now().getTime();
          await this.gateway.actions.updateRoutineStep({
            commandId: commandId('routine.step'),
            deviceId: this.deviceId,
            issuedAt: now,
            payload: {
              routineRunId: run.id,
              stepId: change.stepId,
              status: change.completed ? 'completed' : 'pending',
              finishedAt: change.completed ? now : null,
              elapsedSeconds: 0,
              updatedAt: now,
            },
          });
          break;
        }
        case 'routine.finish': {
          const run = await findRoutineRun(
            this.database,
            change.routine.id,
            localDate,
          );
          if (run?.status === 'running') {
            await this.gateway.actions.finishRoutineRun({
              commandId: commandId('routine.finish'),
              deviceId: this.deviceId,
              payload: {
                routineRunId: run.id,
                status: change.completed ? 'completed' : 'abandoned',
                finishedAt: this.now().getTime(),
              },
            });
          }
          break;
        }
        case 'routine.reset': {
          const run = await findRoutineRun(
            this.database,
            change.routine.id,
            localDate,
          );
          if (run)
            await resetRoutineRun(
              this.database,
              this.deviceId,
              run.id,
              this.now().getTime(),
            );
          break;
        }
        case 'dashboard.reorder': {
          const orderIndex = new Map(
            change.order.map((section, index) => [section, index]),
          );
          await this.gateway.actions.reorderDashboard({
            commandId: commandId('dashboard.reorder'),
            deviceId: this.deviceId,
            payload: {
              entries: [
                ...snapshot.habits.map((item) => ({
                  item,
                  section: 'habits' as const,
                })),
                ...snapshot.tasks.map((item) => ({
                  item,
                  section: 'tasks' as const,
                })),
                ...snapshot.routines.map((item) => ({
                  item,
                  section: 'routines' as const,
                })),
              ].map(({ item, section }) => ({
                itemId: item.id,
                sectionKey: `${String(orderIndex.get(section) ?? 99).padStart(2, '0')}:${section}`,
                sortOrder: item.sortOrder,
              })),
              updatedAt: this.now().getTime(),
            },
          });
          break;
        }
      }
    }
  }
}
