import type { SQLiteDatabase } from 'expo-sqlite';

import { executeIdempotentCommand } from '../idempotency';
import { recordMutation } from '../oplog';
import type { CommandExecution } from '../types';
import { createUuid } from '../uuid';

type CommandEnvelope<T> = {
  commandId: string;
  deviceId: string;
  issuedAt?: number;
  payload: T;
};

export type RecordMeasurementInput = {
  id?: string;
  itemId: string;
  workspaceId?: string;
  occurrenceKey?: string | null;
  sessionId?: string | null;
  scheduleVersionId?: string | null;
  slotId?: string | null;
  value: number;
  operation?: 'add' | 'set';
  unit?: string | null;
  occurredAt: number;
  localDate: string;
  startedAt?: number | null;
  endedAt?: number | null;
  source?: 'app' | 'notification' | 'widget' | 'timer' | 'sync' | 'import';
  note?: string | null;
};

export type SetOccurrenceOverrideInput = {
  id?: string;
  itemId: string;
  workspaceId?: string;
  occurrenceKey: string;
  localDate: string;
  slotId?: string | null;
  state: 'complete' | 'excused' | 'reset' | 'force_due' | 'force_not_due';
  value?: number | null;
  note?: string | null;
  updatedAt?: number;
};

export type SetTaskInstanceStatusInput = {
  id?: string;
  taskId: string;
  workspaceId?: string;
  occurrenceKey: string;
  localDate: string;
  scheduleVersionId?: string | null;
  slotId?: string | null;
  scheduledFor?: number | null;
  dueAt?: number | null;
  deadlineAt?: number | null;
  status: 'pending' | 'completed' | 'skipped' | 'cancelled';
  completedAt?: number | null;
  snoozedUntil?: number | null;
  updatedAt?: number;
};

export class ProgressRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  recordMeasurement(
    command: CommandEnvelope<RecordMeasurementInput>,
  ): Promise<CommandExecution<{ measurementId: string }>> {
    return executeIdempotentCommand(
      this.database,
      {
        id: command.commandId,
        name: 'progress.record_measurement',
        payload: command.payload,
        issuedAt: command.issuedAt,
      },
      async (transaction) => {
        const id = command.payload.id ?? createUuid();
        const now = command.issuedAt ?? Date.now();
        await transaction.runAsync(
          `INSERT INTO measurements
            (id, item_id, occurrence_key, session_id, schedule_version_id, slot_id,
             value, operation, unit,
             occurred_at, local_date, started_at, ended_at, source, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            command.payload.itemId,
            command.payload.occurrenceKey ?? null,
            command.payload.sessionId ?? null,
            command.payload.scheduleVersionId ?? null,
            command.payload.slotId ?? null,
            command.payload.value,
            command.payload.operation ?? 'add',
            command.payload.unit ?? null,
            command.payload.occurredAt,
            command.payload.localDate,
            command.payload.startedAt ?? null,
            command.payload.endedAt ?? null,
            command.payload.source ?? 'app',
            command.payload.note ?? null,
            now,
            now,
          ],
        );
        await recordMutation(transaction, {
          commandId: command.commandId,
          deviceId: command.deviceId,
          workspaceId: command.payload.workspaceId,
          entityType: 'measurement',
          entityId: id,
          operation: 'upsert',
          payload: { ...command.payload, id },
          now,
        });
        return { measurementId: id };
      },
    );
  }

  setOccurrenceOverride(
    command: CommandEnvelope<SetOccurrenceOverrideInput>,
  ): Promise<CommandExecution<{ itemId: string; occurrenceKey: string }>> {
    return executeIdempotentCommand(
      this.database,
      {
        id: command.commandId,
        name: 'progress.set_occurrence_override',
        payload: command.payload,
        issuedAt: command.issuedAt,
      },
      async (transaction) => {
        const now = command.payload.updatedAt ?? command.issuedAt ?? Date.now();
        const existing = await transaction.getFirstAsync<{ id: string }>(
          `SELECT id FROM occurrence_overrides
           WHERE item_id = ? AND occurrence_key = ?`,
          [command.payload.itemId, command.payload.occurrenceKey],
        );
        const id = existing?.id ?? command.payload.id ?? createUuid();
        await transaction.runAsync(
          `INSERT INTO occurrence_overrides
            (id, item_id, occurrence_key, local_date, slot_id, state, value, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(item_id, occurrence_key) DO UPDATE SET
             local_date = excluded.local_date,
             slot_id = excluded.slot_id,
             state = excluded.state,
             value = excluded.value,
             note = excluded.note,
             updated_at = excluded.updated_at`,
          [
            id,
            command.payload.itemId,
            command.payload.occurrenceKey,
            command.payload.localDate,
            command.payload.slotId ?? null,
            command.payload.state,
            command.payload.value ?? null,
            command.payload.note ?? null,
            now,
            now,
          ],
        );
        await recordMutation(transaction, {
          commandId: command.commandId,
          deviceId: command.deviceId,
          workspaceId: command.payload.workspaceId,
          entityType: 'occurrence_override',
          entityId: id,
          operation: 'upsert',
          payload: { ...command.payload, id },
          now,
        });
        return {
          itemId: command.payload.itemId,
          occurrenceKey: command.payload.occurrenceKey,
        };
      },
    );
  }

  setTaskInstanceStatus(
    command: CommandEnvelope<SetTaskInstanceStatusInput>,
  ): Promise<CommandExecution<{ taskInstanceId: string }>> {
    return executeIdempotentCommand(
      this.database,
      {
        id: command.commandId,
        name: 'task_instance.set_status',
        payload: command.payload,
        issuedAt: command.issuedAt,
      },
      async (transaction) => {
        const now = command.payload.updatedAt ?? command.issuedAt ?? Date.now();
        const existing = await transaction.getFirstAsync<{ id: string }>(
          'SELECT id FROM task_instances WHERE task_id = ? AND occurrence_key = ?',
          [command.payload.taskId, command.payload.occurrenceKey],
        );
        const id = existing?.id ?? command.payload.id ?? createUuid();
        const completedAt =
          command.payload.status === 'completed'
            ? (command.payload.completedAt ?? now)
            : null;
        await transaction.runAsync(
          `INSERT INTO task_instances
            (id, task_id, schedule_version_id, slot_id, occurrence_key, local_date,
             scheduled_for, due_at, deadline_at, status, completed_at, snoozed_until,
             generated_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(task_id, occurrence_key) DO UPDATE SET
             schedule_version_id = excluded.schedule_version_id,
             slot_id = excluded.slot_id,
             local_date = excluded.local_date,
             scheduled_for = excluded.scheduled_for,
             due_at = excluded.due_at,
             deadline_at = excluded.deadline_at,
             status = excluded.status,
             completed_at = excluded.completed_at,
             snoozed_until = excluded.snoozed_until,
             updated_at = excluded.updated_at`,
          [
            id,
            command.payload.taskId,
            command.payload.scheduleVersionId ?? null,
            command.payload.slotId ?? null,
            command.payload.occurrenceKey,
            command.payload.localDate,
            command.payload.scheduledFor ?? null,
            command.payload.dueAt ?? null,
            command.payload.deadlineAt ?? null,
            command.payload.status,
            completedAt,
            command.payload.snoozedUntil ?? null,
            now,
            now,
          ],
        );
        await recordMutation(transaction, {
          commandId: command.commandId,
          deviceId: command.deviceId,
          workspaceId: command.payload.workspaceId,
          entityType: 'task_instance',
          entityId: id,
          operation: 'upsert',
          payload: { ...command.payload, id, completedAt },
          now,
        });
        return { taskInstanceId: id };
      },
    );
  }
}
