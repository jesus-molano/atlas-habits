import type { SQLiteDatabase } from 'expo-sqlite';

import { stableStringify } from '../canonical-json';
import { executeIdempotentCommand } from '../idempotency';
import { recordMutation } from '../oplog';
import type { SqlExecutor } from '../transaction';
import {
  LOCAL_WORKSPACE_ID,
  type CommandExecution,
  type ItemRecord,
  type ItemType,
  type MeasurementType,
  type ScheduleGoalInput,
  type ScheduleSlotInput,
  type ScheduleVersionInput,
} from '../types';
import { createUuid } from '../uuid';

type CommandEnvelope<T> = {
  commandId: string;
  deviceId: string;
  issuedAt?: number;
  payload: T;
};

type BaseItemInput = {
  id?: string;
  workspaceId?: string;
  title: string;
  notes?: string | null;
  color?: string | null;
  icon?: string | null;
  categoryId?: string | null;
  tagIds?: string[];
  sortOrder?: number;
  createdAt?: number;
  schedule?: ScheduleVersionInput & { id?: string; timezone: string };
};

export type CreateHabitInput = BaseItemInput & {
  measurementType: MeasurementType;
  unit?: string | null;
  defaultValue?: number;
};

export type CreateTaskInput = BaseItemInput & {
  priority?: 0 | 1 | 2 | 3;
  allDay?: boolean;
  dueAt?: number | null;
  deadlineAt?: number | null;
  subtasks?: {
    id?: string;
    title: string;
    sortOrder?: number;
    required?: boolean;
  }[];
};

export type CreateRoutineInput = BaseItemInput & {
  completionPolicy?: 'all_required' | 'manual';
  steps?: {
    id?: string;
    title: string;
    notes?: string | null;
    sortOrder?: number;
    required?: boolean;
    durationSeconds?: number | null;
  }[];
};

export type CreateItemResult = {
  itemId: string;
  scheduleId: string | null;
  scheduleVersionId: string | null;
};

type ItemRow = {
  id: string;
  workspace_id: string;
  type: ItemType;
  title: string;
  notes: string | null;
  color: string | null;
  icon: string | null;
  category_id: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  deleted_at: number | null;
};

type InsertedSchedule = {
  scheduleId: string;
  versionId: string;
  slots: (ScheduleSlotInput & { id: string })[];
  goals: (ScheduleGoalInput & { id: string; slotId: string | null })[];
};

function mapItem(row: ItemRow): ItemRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type,
    title: row.title,
    notes: row.notes,
    color: row.color,
    icon: row.icon,
    categoryId: row.category_id,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
  };
}

async function insertBaseItem(
  transaction: SqlExecutor,
  type: ItemType,
  input: BaseItemInput,
  itemId: string,
  now: number,
): Promise<void> {
  const title = input.title.trim();
  if (!title) throw new Error('The item title cannot be empty.');

  await transaction.runAsync(
    `INSERT INTO items
      (id, workspace_id, type, title, notes, color, icon, category_id,
       sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      itemId,
      input.workspaceId ?? LOCAL_WORKSPACE_ID,
      type,
      title,
      input.notes ?? null,
      input.color ?? null,
      input.icon ?? null,
      input.categoryId ?? null,
      input.sortOrder ?? now,
      now,
      now,
    ],
  );

  for (const tagId of new Set(input.tagIds ?? [])) {
    await transaction.runAsync(
      'INSERT INTO item_tags (item_id, tag_id, created_at) VALUES (?, ?, ?)',
      [itemId, tagId, now],
    );
  }
}

async function insertSchedule(
  transaction: SqlExecutor,
  itemId: string,
  input: NonNullable<BaseItemInput['schedule']>,
  now: number,
): Promise<InsertedSchedule> {
  const scheduleId = input.id ?? createUuid();
  const versionId = createUuid();
  await transaction.runAsync(
    `INSERT INTO schedules (id, item_id, timezone, created_at)
     VALUES (?, ?, ?, ?)`,
    [scheduleId, itemId, input.timezone, now],
  );
  await transaction.runAsync(
    `INSERT INTO schedule_versions
      (id, schedule_id, version_number, effective_from, effective_until,
       rule_type, rule_json, grace_minutes, created_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    [
      versionId,
      scheduleId,
      input.effectiveFrom,
      input.effectiveUntil ?? null,
      input.ruleType,
      stableStringify(input.rule),
      input.graceMinutes ?? 0,
      now,
    ],
  );

  const slots = (input.slots ?? []).map((slot) => ({
    ...slot,
    id: slot.id ?? createUuid(),
  }));
  const slotsByKey = new Map(slots.map((slot) => [slot.key, slot.id]));
  for (const slot of slots) {
    await transaction.runAsync(
      `INSERT INTO schedule_slots
        (id, schedule_version_id, slot_key, label, local_time, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        slot.id,
        versionId,
        slot.key,
        slot.label ?? null,
        slot.localTime ?? null,
        slot.sortOrder ?? 0,
      ],
    );
  }

  const goals = (input.goals ?? []).map((goal) => {
    const slotId =
      goal.slotId ??
      (goal.slotKey ? slotsByKey.get(goal.slotKey) : null) ??
      null;
    if (goal.slotKey && !slotId)
      throw new Error(`Unknown schedule slot: ${goal.slotKey}`);
    return { ...goal, id: goal.id ?? createUuid(), slotId };
  });
  for (const goal of goals) {
    await transaction.runAsync(
      `INSERT INTO schedule_goals
        (id, schedule_version_id, slot_id, measurement_type, aggregation,
         comparison, target_value, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        goal.id,
        versionId,
        goal.slotId,
        goal.measurementType,
        goal.aggregation ??
          (goal.measurementType === 'boolean' ? 'count' : 'sum'),
        goal.comparison ?? 'at_least',
        goal.targetValue,
        goal.unit ?? null,
      ],
    );
  }

  return { scheduleId, versionId, slots, goals };
}

async function maybeInsertSchedule(
  transaction: SqlExecutor,
  itemId: string,
  input: BaseItemInput,
  now: number,
): Promise<InsertedSchedule | null> {
  return input.schedule
    ? insertSchedule(transaction, itemId, input.schedule, now)
    : null;
}

export class ItemRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  async getById(itemId: string): Promise<ItemRecord | null> {
    const row = await this.database.getFirstAsync<ItemRow>(
      `SELECT id, workspace_id, type, title, notes, color, icon, category_id,
              sort_order, created_at, updated_at, archived_at, deleted_at
       FROM items WHERE id = ?`,
      [itemId],
    );
    return row ? mapItem(row) : null;
  }

  createHabit(
    command: CommandEnvelope<CreateHabitInput>,
  ): Promise<CommandExecution<CreateItemResult>> {
    return executeIdempotentCommand(
      this.database,
      {
        id: command.commandId,
        name: 'item.create_habit',
        payload: command.payload,
        issuedAt: command.issuedAt,
      },
      async (transaction) => {
        const now = command.payload.createdAt ?? command.issuedAt ?? Date.now();
        const itemId = command.payload.id ?? createUuid();
        await insertBaseItem(
          transaction,
          'habit',
          command.payload,
          itemId,
          now,
        );
        await transaction.runAsync(
          `INSERT INTO habits (item_id, measurement_type, unit, default_value)
           VALUES (?, ?, ?, ?)`,
          [
            itemId,
            command.payload.measurementType,
            command.payload.unit ?? null,
            command.payload.defaultValue ?? 1,
          ],
        );
        const schedule = await maybeInsertSchedule(
          transaction,
          itemId,
          command.payload,
          now,
        );
        await recordMutation(transaction, {
          commandId: command.commandId,
          deviceId: command.deviceId,
          workspaceId: command.payload.workspaceId,
          entityType: 'item',
          entityId: itemId,
          operation: 'upsert',
          payload: {
            ...command.payload,
            id: itemId,
            type: 'habit',
            schedule:
              command.payload.schedule && schedule
                ? {
                    ...command.payload.schedule,
                    id: schedule.scheduleId,
                    versionId: schedule.versionId,
                    slots: schedule.slots,
                    goals: schedule.goals,
                  }
                : null,
          },
          now,
        });
        return {
          itemId,
          scheduleId: schedule?.scheduleId ?? null,
          scheduleVersionId: schedule?.versionId ?? null,
        };
      },
    );
  }

  createTask(
    command: CommandEnvelope<CreateTaskInput>,
  ): Promise<CommandExecution<CreateItemResult>> {
    return executeIdempotentCommand(
      this.database,
      {
        id: command.commandId,
        name: 'item.create_task',
        payload: command.payload,
        issuedAt: command.issuedAt,
      },
      async (transaction) => {
        const now = command.payload.createdAt ?? command.issuedAt ?? Date.now();
        const itemId = command.payload.id ?? createUuid();
        await insertBaseItem(transaction, 'task', command.payload, itemId, now);
        await transaction.runAsync(
          `INSERT INTO tasks (item_id, priority, all_day, due_at, deadline_at)
           VALUES (?, ?, ?, ?, ?)`,
          [
            itemId,
            command.payload.priority ?? 0,
            command.payload.allDay === false ? 0 : 1,
            command.payload.dueAt ?? null,
            command.payload.deadlineAt ?? null,
          ],
        );
        const subtasks = (command.payload.subtasks ?? []).map((subtask) => ({
          ...subtask,
          id: subtask.id ?? createUuid(),
        }));
        for (const subtask of subtasks) {
          await transaction.runAsync(
            `INSERT INTO task_subtasks
              (id, task_id, title, sort_order, required, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              subtask.id,
              itemId,
              subtask.title.trim(),
              subtask.sortOrder ?? 0,
              subtask.required === false ? 0 : 1,
              now,
              now,
            ],
          );
        }
        const schedule = await maybeInsertSchedule(
          transaction,
          itemId,
          command.payload,
          now,
        );
        await recordMutation(transaction, {
          commandId: command.commandId,
          deviceId: command.deviceId,
          workspaceId: command.payload.workspaceId,
          entityType: 'item',
          entityId: itemId,
          operation: 'upsert',
          payload: {
            ...command.payload,
            id: itemId,
            type: 'task',
            subtasks,
            schedule:
              command.payload.schedule && schedule
                ? {
                    ...command.payload.schedule,
                    id: schedule.scheduleId,
                    versionId: schedule.versionId,
                    slots: schedule.slots,
                    goals: schedule.goals,
                  }
                : null,
          },
          now,
        });
        return {
          itemId,
          scheduleId: schedule?.scheduleId ?? null,
          scheduleVersionId: schedule?.versionId ?? null,
        };
      },
    );
  }

  createRoutine(
    command: CommandEnvelope<CreateRoutineInput>,
  ): Promise<CommandExecution<CreateItemResult>> {
    return executeIdempotentCommand(
      this.database,
      {
        id: command.commandId,
        name: 'item.create_routine',
        payload: command.payload,
        issuedAt: command.issuedAt,
      },
      async (transaction) => {
        const now = command.payload.createdAt ?? command.issuedAt ?? Date.now();
        const itemId = command.payload.id ?? createUuid();
        await insertBaseItem(
          transaction,
          'routine',
          command.payload,
          itemId,
          now,
        );
        await transaction.runAsync(
          'INSERT INTO routines (item_id, completion_policy) VALUES (?, ?)',
          [itemId, command.payload.completionPolicy ?? 'all_required'],
        );
        const steps = (command.payload.steps ?? []).map((step) => ({
          ...step,
          id: step.id ?? createUuid(),
        }));
        for (const step of steps) {
          await transaction.runAsync(
            `INSERT INTO routine_steps
              (id, routine_id, title, notes, sort_order, required, duration_seconds,
               created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              step.id,
              itemId,
              step.title.trim(),
              step.notes ?? null,
              step.sortOrder ?? 0,
              step.required === false ? 0 : 1,
              step.durationSeconds ?? null,
              now,
              now,
            ],
          );
        }
        const schedule = await maybeInsertSchedule(
          transaction,
          itemId,
          command.payload,
          now,
        );
        await recordMutation(transaction, {
          commandId: command.commandId,
          deviceId: command.deviceId,
          workspaceId: command.payload.workspaceId,
          entityType: 'item',
          entityId: itemId,
          operation: 'upsert',
          payload: {
            ...command.payload,
            id: itemId,
            type: 'routine',
            steps,
            schedule:
              command.payload.schedule && schedule
                ? {
                    ...command.payload.schedule,
                    id: schedule.scheduleId,
                    versionId: schedule.versionId,
                    slots: schedule.slots,
                    goals: schedule.goals,
                  }
                : null,
          },
          now,
        });
        return {
          itemId,
          scheduleId: schedule?.scheduleId ?? null,
          scheduleVersionId: schedule?.versionId ?? null,
        };
      },
    );
  }

  deleteItem(
    command: CommandEnvelope<{
      itemId: string;
      workspaceId?: string;
      deletedAt?: number;
    }>,
  ): Promise<CommandExecution<{ itemId: string; deletedAt: number }>> {
    return executeIdempotentCommand(
      this.database,
      {
        id: command.commandId,
        name: 'item.delete',
        payload: command.payload,
        issuedAt: command.issuedAt,
      },
      async (transaction) => {
        const deletedAt =
          command.payload.deletedAt ?? command.issuedAt ?? Date.now();
        const result = await transaction.runAsync(
          `UPDATE items SET deleted_at = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
          [deletedAt, deletedAt, command.payload.itemId],
        );
        if (result.changes !== 1) {
          const existing = await transaction.getFirstAsync<{
            deleted_at: number | null;
          }>('SELECT deleted_at FROM items WHERE id = ?', [
            command.payload.itemId,
          ]);
          if (!existing)
            throw new Error(`Item ${command.payload.itemId} does not exist.`);
        }
        await recordMutation(transaction, {
          commandId: command.commandId,
          deviceId: command.deviceId,
          workspaceId: command.payload.workspaceId,
          entityType: 'item',
          entityId: command.payload.itemId,
          operation: 'delete',
          payload: { id: command.payload.itemId, deletedAt },
          changedFields: ['deletedAt'],
          now: deletedAt,
        });
        return { itemId: command.payload.itemId, deletedAt };
      },
    );
  }
}
