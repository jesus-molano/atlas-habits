import type { SQLiteDatabase } from 'expo-sqlite';

import { executeIdempotentCommand } from '../idempotency';
import { assertLocalDate } from '../local-date';
import { recordMutation } from '../oplog';
import { LOCAL_WORKSPACE_ID, type CommandExecution } from '../types';
import { createUuid } from '../uuid';

type CommandEnvelope<T> = {
  commandId: string;
  deviceId: string;
  issuedAt?: number;
  payload: T;
};

export type ReorderDashboardInput = {
  workspaceId?: string;
  entries: {
    itemId: string;
    sectionKey?: string;
    sortOrder: number;
    hidden?: boolean;
  }[];
  updatedAt?: number;
};

export type PauseItemInput = {
  id?: string;
  itemId: string;
  workspaceId?: string;
  startDate: string;
  endDate?: string | null;
  reason?: string | null;
  createdAt?: number;
};

export type ResumeItemInput = {
  pauseId: string;
  itemId: string;
  workspaceId?: string;
  /** First local date on which the item is active again. */
  resumeOn: string;
  updatedAt?: number;
};

export type StartRoutineRunInput = {
  id?: string;
  routineId: string;
  workspaceId?: string;
  occurrenceKey?: string | null;
  scheduleVersionId?: string | null;
  slotId?: string | null;
  localDate: string;
  startedAt?: number;
};

export type UpdateRoutineStepInput = {
  routineRunId: string;
  stepId: string;
  workspaceId?: string;
  status: 'pending' | 'running' | 'completed' | 'skipped';
  startedAt?: number | null;
  finishedAt?: number | null;
  elapsedSeconds?: number;
  note?: string | null;
  updatedAt?: number;
};

export type FinishRoutineRunInput = {
  routineRunId: string;
  workspaceId?: string;
  status: 'completed' | 'abandoned';
  finishedAt?: number;
};

export type UpsertReminderRuleInput = {
  id?: string;
  itemId: string;
  workspaceId?: string;
  scheduleSlotId?: string | null;
  enabled?: boolean;
  triggerType?: 'scheduled' | 'before_due' | 'after_due';
  localTime?: string | null;
  offsetMinutes?: number;
  exactAlarm?: boolean;
  allowComplete?: boolean;
  allowSnooze?: boolean;
  snoozeMinutes?: number;
  repeatUntilCompleted?: boolean;
  repeatIntervalMinutes?: number | null;
  androidNotificationKey?: string | null;
  updatedAt?: number;
};

type PauseRow = { id: string; start_date: string };

export class ActionRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  reorderDashboard(
    command: CommandEnvelope<ReorderDashboardInput>,
  ): Promise<CommandExecution<{ updated: number }>> {
    return executeIdempotentCommand(
      this.database,
      {
        id: command.commandId,
        name: 'dashboard.reorder',
        payload: command.payload,
        issuedAt: command.issuedAt,
      },
      async (transaction) => {
        const workspaceId = command.payload.workspaceId ?? LOCAL_WORKSPACE_ID;
        const now = command.payload.updatedAt ?? command.issuedAt ?? Date.now();
        const entries = [...command.payload.entries].sort(
          (left, right) => left.sortOrder - right.sortOrder,
        );
        for (const entry of entries) {
          await transaction.runAsync(
            `INSERT INTO dashboard_layout
              (workspace_id, item_id, section_key, sort_order, hidden, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(workspace_id, item_id) DO UPDATE SET
               section_key = excluded.section_key,
               sort_order = excluded.sort_order,
               hidden = excluded.hidden,
               updated_at = excluded.updated_at`,
            [
              workspaceId,
              entry.itemId,
              entry.sectionKey ?? 'default',
              entry.sortOrder,
              entry.hidden ? 1 : 0,
              now,
            ],
          );
        }
        await recordMutation(transaction, {
          commandId: command.commandId,
          deviceId: command.deviceId,
          workspaceId,
          entityType: 'dashboard_layout',
          entityId: workspaceId,
          operation: 'upsert',
          payload: { entries, updatedAt: now },
          now,
        });
        return { updated: entries.length };
      },
    );
  }

  pauseItem(
    command: CommandEnvelope<PauseItemInput>,
  ): Promise<CommandExecution<{ pauseId: string }>> {
    assertLocalDate(command.payload.startDate);
    if (command.payload.endDate) assertLocalDate(command.payload.endDate);
    if (
      command.payload.endDate &&
      command.payload.endDate < command.payload.startDate
    ) {
      throw new Error('A pause cannot end before it starts.');
    }

    return executeIdempotentCommand(
      this.database,
      {
        id: command.commandId,
        name: 'item.pause',
        payload: command.payload,
        issuedAt: command.issuedAt,
      },
      async (transaction) => {
        const overlap = await transaction.getFirstAsync<{ id: string }>(
          `SELECT id FROM item_pauses
           WHERE item_id = ?
             AND start_date <= COALESCE(?, '9999-12-31')
             AND COALESCE(end_date, '9999-12-31') >= ?
           LIMIT 1`,
          [
            command.payload.itemId,
            command.payload.endDate ?? null,
            command.payload.startDate,
          ],
        );
        if (overlap)
          throw new Error(
            `Item ${command.payload.itemId} already has an overlapping pause.`,
          );

        const id = command.payload.id ?? createUuid();
        const now = command.payload.createdAt ?? command.issuedAt ?? Date.now();
        await transaction.runAsync(
          `INSERT INTO item_pauses
            (id, item_id, start_date, end_date, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            id,
            command.payload.itemId,
            command.payload.startDate,
            command.payload.endDate ?? null,
            command.payload.reason ?? null,
            now,
          ],
        );
        await recordMutation(transaction, {
          commandId: command.commandId,
          deviceId: command.deviceId,
          workspaceId: command.payload.workspaceId,
          entityType: 'item_pause',
          entityId: id,
          operation: 'upsert',
          payload: { ...command.payload, id },
          now,
        });
        return { pauseId: id };
      },
    );
  }

  resumeItem(command: CommandEnvelope<ResumeItemInput>): Promise<
    CommandExecution<{
      pauseId: string;
      removed: boolean;
      endDate: string | null;
    }>
  > {
    assertLocalDate(command.payload.resumeOn);
    return executeIdempotentCommand(
      this.database,
      {
        id: command.commandId,
        name: 'item.resume',
        payload: command.payload,
        issuedAt: command.issuedAt,
      },
      async (transaction) => {
        const pause = await transaction.getFirstAsync<PauseRow>(
          'SELECT id, start_date FROM item_pauses WHERE id = ? AND item_id = ?',
          [command.payload.pauseId, command.payload.itemId],
        );
        if (!pause)
          throw new Error(`Pause ${command.payload.pauseId} does not exist.`);
        const now = command.payload.updatedAt ?? command.issuedAt ?? Date.now();
        const removed = command.payload.resumeOn <= pause.start_date;
        let endDate: string | null = null;
        if (removed) {
          await transaction.runAsync('DELETE FROM item_pauses WHERE id = ?', [
            pause.id,
          ]);
        } else {
          const row = await transaction.getFirstAsync<{ end_date: string }>(
            `UPDATE item_pauses SET end_date = date(?, '-1 day')
             WHERE id = ? RETURNING end_date`,
            [command.payload.resumeOn, pause.id],
          );
          endDate = row?.end_date ?? null;
        }
        await recordMutation(transaction, {
          commandId: command.commandId,
          deviceId: command.deviceId,
          workspaceId: command.payload.workspaceId,
          entityType: 'item_pause',
          entityId: pause.id,
          operation: removed ? 'delete' : 'upsert',
          payload: { ...command.payload, endDate },
          now,
        });
        return { pauseId: pause.id, removed, endDate };
      },
    );
  }

  startRoutineRun(
    command: CommandEnvelope<StartRoutineRunInput>,
  ): Promise<CommandExecution<{ routineRunId: string; stepCount: number }>> {
    assertLocalDate(command.payload.localDate);
    return executeIdempotentCommand(
      this.database,
      {
        id: command.commandId,
        name: 'routine_run.start',
        payload: command.payload,
        issuedAt: command.issuedAt,
      },
      async (transaction) => {
        const id = command.payload.id ?? createUuid();
        const now = command.payload.startedAt ?? command.issuedAt ?? Date.now();
        await transaction.runAsync(
          `INSERT INTO routine_runs
            (id, routine_id, schedule_version_id, slot_id, occurrence_key,
             local_date, status, started_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
          [
            id,
            command.payload.routineId,
            command.payload.scheduleVersionId ?? null,
            command.payload.slotId ?? null,
            command.payload.occurrenceKey ?? null,
            command.payload.localDate,
            now,
            now,
          ],
        );
        const steps = await transaction.getAllAsync<{ id: string }>(
          `SELECT id FROM routine_steps
           WHERE routine_id = ? AND deleted_at IS NULL
           ORDER BY sort_order, created_at`,
          [command.payload.routineId],
        );
        for (const step of steps) {
          await transaction.runAsync(
            `INSERT INTO routine_run_steps
              (routine_run_id, step_id, status, elapsed_seconds, updated_at)
             VALUES (?, ?, 'pending', 0, ?)`,
            [id, step.id, now],
          );
        }
        await recordMutation(transaction, {
          commandId: command.commandId,
          deviceId: command.deviceId,
          workspaceId: command.payload.workspaceId,
          entityType: 'routine_run',
          entityId: id,
          operation: 'upsert',
          payload: {
            ...command.payload,
            id,
            stepIds: steps.map((step) => step.id),
          },
          now,
        });
        return { routineRunId: id, stepCount: steps.length };
      },
    );
  }

  updateRoutineStep(
    command: CommandEnvelope<UpdateRoutineStepInput>,
  ): Promise<CommandExecution<{ routineRunId: string; stepId: string }>> {
    return executeIdempotentCommand(
      this.database,
      {
        id: command.commandId,
        name: 'routine_run.update_step',
        payload: command.payload,
        issuedAt: command.issuedAt,
      },
      async (transaction) => {
        const now = command.payload.updatedAt ?? command.issuedAt ?? Date.now();
        const result = await transaction.runAsync(
          `UPDATE routine_run_steps SET
             status = ?, started_at = ?, finished_at = ?, elapsed_seconds = ?,
             note = ?, updated_at = ?
           WHERE routine_run_id = ? AND step_id = ?`,
          [
            command.payload.status,
            command.payload.startedAt ?? null,
            command.payload.finishedAt ?? null,
            command.payload.elapsedSeconds ?? 0,
            command.payload.note ?? null,
            now,
            command.payload.routineRunId,
            command.payload.stepId,
          ],
        );
        if (result.changes !== 1)
          throw new Error('The routine run step does not exist.');
        const entityId = `${command.payload.routineRunId}:${command.payload.stepId}`;
        await recordMutation(transaction, {
          commandId: command.commandId,
          deviceId: command.deviceId,
          workspaceId: command.payload.workspaceId,
          entityType: 'routine_run_step',
          entityId,
          operation: 'upsert',
          payload: command.payload,
          now,
        });
        return {
          routineRunId: command.payload.routineRunId,
          stepId: command.payload.stepId,
        };
      },
    );
  }

  finishRoutineRun(command: CommandEnvelope<FinishRoutineRunInput>): Promise<
    CommandExecution<{
      routineRunId: string;
      status: FinishRoutineRunInput['status'];
    }>
  > {
    return executeIdempotentCommand(
      this.database,
      {
        id: command.commandId,
        name: 'routine_run.finish',
        payload: command.payload,
        issuedAt: command.issuedAt,
      },
      async (transaction) => {
        const now =
          command.payload.finishedAt ?? command.issuedAt ?? Date.now();
        const result = await transaction.runAsync(
          `UPDATE routine_runs
           SET status = ?, finished_at = ?, updated_at = ?
           WHERE id = ? AND status = 'running'`,
          [command.payload.status, now, now, command.payload.routineRunId],
        );
        if (result.changes !== 1)
          throw new Error('The routine run is missing or already finished.');
        await recordMutation(transaction, {
          commandId: command.commandId,
          deviceId: command.deviceId,
          workspaceId: command.payload.workspaceId,
          entityType: 'routine_run',
          entityId: command.payload.routineRunId,
          operation: 'upsert',
          payload: { ...command.payload, finishedAt: now },
          changedFields: ['status', 'finishedAt'],
          now,
        });
        return {
          routineRunId: command.payload.routineRunId,
          status: command.payload.status,
        };
      },
    );
  }

  upsertReminderRule(
    command: CommandEnvelope<UpsertReminderRuleInput>,
  ): Promise<CommandExecution<{ reminderRuleId: string }>> {
    return executeIdempotentCommand(
      this.database,
      {
        id: command.commandId,
        name: 'reminder_rule.upsert',
        payload: command.payload,
        issuedAt: command.issuedAt,
      },
      async (transaction) => {
        const id = command.payload.id ?? createUuid();
        const now = command.payload.updatedAt ?? command.issuedAt ?? Date.now();
        const resolved = {
          id,
          itemId: command.payload.itemId,
          workspaceId: command.payload.workspaceId,
          scheduleSlotId: command.payload.scheduleSlotId ?? null,
          enabled: command.payload.enabled !== false,
          triggerType: command.payload.triggerType ?? 'scheduled',
          localTime: command.payload.localTime ?? null,
          offsetMinutes: command.payload.offsetMinutes ?? 0,
          exactAlarm: command.payload.exactAlarm !== false,
          allowComplete: command.payload.allowComplete !== false,
          allowSnooze: command.payload.allowSnooze !== false,
          snoozeMinutes: command.payload.snoozeMinutes ?? 10,
          repeatUntilCompleted: command.payload.repeatUntilCompleted === true,
          repeatIntervalMinutes: command.payload.repeatIntervalMinutes ?? null,
          androidNotificationKey:
            command.payload.androidNotificationKey ?? null,
          updatedAt: now,
        };
        await transaction.runAsync(
          `INSERT INTO reminder_rules
            (id, item_id, schedule_slot_id, enabled, trigger_type, local_time,
             offset_minutes, exact_alarm, allow_complete, allow_snooze,
             snooze_minutes, repeat_until_completed, repeat_interval_minutes,
             android_notification_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            id,
            resolved.itemId,
            resolved.scheduleSlotId,
            resolved.enabled ? 1 : 0,
            resolved.triggerType,
            resolved.localTime,
            resolved.offsetMinutes,
            resolved.exactAlarm ? 1 : 0,
            resolved.allowComplete ? 1 : 0,
            resolved.allowSnooze ? 1 : 0,
            resolved.snoozeMinutes,
            resolved.repeatUntilCompleted ? 1 : 0,
            resolved.repeatIntervalMinutes,
            resolved.androidNotificationKey,
            now,
            now,
          ],
        );
        await recordMutation(transaction, {
          commandId: command.commandId,
          deviceId: command.deviceId,
          workspaceId: command.payload.workspaceId,
          entityType: 'reminder_rule',
          entityId: id,
          operation: 'upsert',
          payload: resolved,
          now,
        });
        return { reminderRuleId: id };
      },
    );
  }
}
