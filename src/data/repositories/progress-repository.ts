import type { SQLiteDatabase } from 'expo-sqlite';

import { executeIdempotentCommand } from '../idempotency';
import { assertLocalDate } from '../local-date';
import { recordMutation } from '../oplog';
import { withWriteTransaction, type SqlExecutor } from '../transaction';
import { LOCAL_WORKSPACE_ID, type CommandExecution } from '../types';
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

export type ActiveTimerRecord = Readonly<{
  workspaceId: string;
  itemId: string;
  itemType: 'habit' | 'task';
  title: string;
  startedAt: number;
  runningSince: number | null;
  elapsedSeconds: number;
}>;

type ActiveTimerRow = Readonly<{
  workspace_id: string;
  item_id: string;
  item_type: 'habit' | 'task';
  title: string;
  started_at: number;
  running_since: number | null;
  elapsed_seconds: number;
}>;

type TrackableItemRow = Readonly<{
  workspace_id: string;
  type: 'habit' | 'task' | 'routine';
  measurement_type: 'boolean' | 'quantity' | 'duration' | null;
}>;

type LegacyTimerRow = Readonly<{
  item_id: string;
  timer_started_at: number;
}>;

type ActiveTimerSegmentRow = Readonly<{
  local_date: string;
  elapsed_seconds: number;
}>;

type TimerSegment = Readonly<{
  localDate: string;
  seconds: number;
}>;

export type StopTimerInput = Readonly<{
  workspaceId?: string;
  localDate: string;
  endedAt?: number;
}>;

export type RecordManualDurationInput = Readonly<{
  itemId: string;
  workspaceId?: string;
  seconds: number;
  localDate: string;
  occurredAt?: number;
}>;

function mapActiveTimer(row: ActiveTimerRow): ActiveTimerRecord {
  return {
    workspaceId: row.workspace_id,
    itemId: row.item_id,
    itemType: row.item_type,
    title: row.title,
    startedAt: row.started_at,
    runningSince: row.running_since,
    elapsedSeconds: row.elapsed_seconds,
  };
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function splitRunningInterval(
  startedAt: number,
  endedAt: number,
): TimerSegment[] {
  if (endedAt <= startedAt) return [];
  const totalSeconds = Math.floor((endedAt - startedAt) / 1_000);
  if (totalSeconds <= 0) return [];

  const totals = new Map<string, number>();
  let cursor = startedAt;
  let allocatedSeconds = 0;
  while (cursor < endedAt) {
    const nextMidnight = new Date(cursor);
    nextMidnight.setHours(24, 0, 0, 0);
    const segmentEnd = Math.min(endedAt, nextMidnight.getTime());
    const cumulativeSeconds =
      segmentEnd === endedAt
        ? totalSeconds
        : Math.min(totalSeconds, Math.floor((segmentEnd - startedAt) / 1_000));
    const seconds = cumulativeSeconds - allocatedSeconds;
    if (seconds > 0) {
      const localDate = localDateKey(cursor);
      totals.set(localDate, (totals.get(localDate) ?? 0) + seconds);
    }
    allocatedSeconds = cumulativeSeconds;
    if (segmentEnd <= cursor) break;
    cursor = segmentEnd;
  }
  return [...totals].map(([localDate, seconds]) => ({ localDate, seconds }));
}

async function addTimerSegments(
  transaction: SqlExecutor,
  workspaceId: string,
  segments: readonly TimerSegment[],
): Promise<void> {
  for (const segment of segments) {
    await transaction.runAsync(
      `INSERT INTO active_timer_segments
        (workspace_id, local_date, elapsed_seconds)
       VALUES (?, ?, ?)
       ON CONFLICT(workspace_id, local_date) DO UPDATE SET
         elapsed_seconds = active_timer_segments.elapsed_seconds + excluded.elapsed_seconds`,
      [workspaceId, segment.localDate, segment.seconds],
    );
  }
}

async function activeTimerFrom(
  database: SqlExecutor,
  workspaceId: string,
): Promise<ActiveTimerRecord | null> {
  const row = await database.getFirstAsync<ActiveTimerRow>(
    `SELECT at.workspace_id, at.item_id, i.type AS item_type, i.title,
            at.started_at, at.running_since, at.elapsed_seconds
       FROM active_timer at
       JOIN items i ON i.id = at.item_id
      WHERE at.workspace_id = ?`,
    [workspaceId],
  );
  return row ? mapActiveTimer(row) : null;
}

async function trackableItem(
  database: SqlExecutor,
  itemId: string,
): Promise<TrackableItemRow> {
  const item = await database.getFirstAsync<TrackableItemRow>(
    `SELECT i.workspace_id, i.type, h.measurement_type
       FROM items i
       LEFT JOIN habits h ON h.item_id = i.id
      WHERE i.id = ? AND i.archived_at IS NULL AND i.deleted_at IS NULL`,
    [itemId],
  );
  if (!item) throw new Error('El elemento ya no existe.');
  if (item.type !== 'task' && item.measurement_type !== 'duration') {
    throw new Error(
      'El cronómetro solo admite tareas y hábitos medidos por tiempo.',
    );
  }
  return item;
}

export class ProgressRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  async getActiveTimer(
    workspaceId = LOCAL_WORKSPACE_ID,
  ): Promise<ActiveTimerRecord | null> {
    return activeTimerFrom(this.database, workspaceId);
  }

  async listLegacyTimerItemIds(): Promise<string[]> {
    const rows = await this.database.getAllAsync<{ item_id: string }>(
      `SELECT h.item_id
         FROM habits h
         JOIN items i ON i.id = h.item_id
        WHERE h.timer_started_at IS NOT NULL
          AND i.archived_at IS NULL
          AND i.deleted_at IS NULL
        ORDER BY h.timer_started_at, h.item_id`,
    );
    return rows.map((row) => row.item_id);
  }

  async startTimer(input: {
    itemId: string;
    workspaceId?: string;
    startedAt?: number;
  }): Promise<ActiveTimerRecord> {
    const workspaceId = input.workspaceId ?? LOCAL_WORKSPACE_ID;
    const startedAt = input.startedAt ?? Date.now();
    await withWriteTransaction(this.database, async (transaction) => {
      const item = await trackableItem(transaction, input.itemId);
      if (item.workspace_id !== workspaceId) {
        throw new Error('El elemento no pertenece a este espacio.');
      }
      const active = await transaction.getFirstAsync<{ item_id: string }>(
        'SELECT item_id FROM active_timer WHERE workspace_id = ?',
        [workspaceId],
      );
      if (active) {
        throw new Error(
          active.item_id === input.itemId
            ? 'Este cronómetro ya está activo.'
            : 'Ya hay otro cronómetro activo. Deténlo o cancélalo primero.',
        );
      }
      await transaction.runAsync(
        `INSERT INTO active_timer
          (workspace_id, item_id, started_at, running_since, elapsed_seconds, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
        [workspaceId, input.itemId, startedAt, startedAt, startedAt, startedAt],
      );
    });
    const timer = await this.getActiveTimer(workspaceId);
    if (!timer) throw new Error('No se pudo iniciar el cronómetro.');
    return timer;
  }

  async pauseTimer(
    workspaceId = LOCAL_WORKSPACE_ID,
    pausedAt = Date.now(),
  ): Promise<ActiveTimerRecord> {
    return withWriteTransaction(this.database, async (transaction) => {
      const timer = await transaction.getFirstAsync<{
        running_since: number | null;
      }>('SELECT running_since FROM active_timer WHERE workspace_id = ?', [
        workspaceId,
      ]);
      if (!timer) throw new Error('No hay ningún cronómetro activo.');
      if (timer.running_since !== null) {
        const segments = splitRunningInterval(timer.running_since, pausedAt);
        const elapsedSeconds = segments.reduce(
          (total, segment) => total + segment.seconds,
          0,
        );
        await addTimerSegments(transaction, workspaceId, segments);
        await transaction.runAsync(
          `UPDATE active_timer
              SET running_since = NULL,
                  elapsed_seconds = elapsed_seconds + ?,
                  updated_at = ?
            WHERE workspace_id = ?`,
          [elapsedSeconds, pausedAt, workspaceId],
        );
      }
      const paused = await activeTimerFrom(transaction, workspaceId);
      if (!paused) throw new Error('No se pudo pausar el cronómetro.');
      return paused;
    });
  }

  async resumeTimer(
    workspaceId = LOCAL_WORKSPACE_ID,
    resumedAt = Date.now(),
  ): Promise<ActiveTimerRecord> {
    return withWriteTransaction(this.database, async (transaction) => {
      const timer = await activeTimerFrom(transaction, workspaceId);
      if (!timer) throw new Error('No hay ningún cronómetro activo.');
      if (timer.runningSince === null) {
        await transaction.runAsync(
          `UPDATE active_timer
              SET running_since = ?, updated_at = ?
            WHERE workspace_id = ?`,
          [resumedAt, resumedAt, workspaceId],
        );
      }
      const resumed = await activeTimerFrom(transaction, workspaceId);
      if (!resumed) throw new Error('No se pudo reanudar el cronómetro.');
      return resumed;
    });
  }

  async cancelTimer(workspaceId = LOCAL_WORKSPACE_ID): Promise<void> {
    await withWriteTransaction(this.database, async (transaction) => {
      await transaction.runAsync(
        'DELETE FROM active_timer WHERE workspace_id = ?',
        [workspaceId],
      );
    });
  }

  stopTimer(command: CommandEnvelope<StopTimerInput>): Promise<
    CommandExecution<{
      measurementId: string;
      itemId: string;
      elapsedSeconds: number;
    }>
  > {
    assertLocalDate(command.payload.localDate);
    return executeIdempotentCommand(
      this.database,
      {
        id: command.commandId,
        name: 'progress.stop_timer',
        payload: command.payload,
        issuedAt: command.issuedAt,
      },
      async (transaction) => {
        const workspaceId = command.payload.workspaceId ?? LOCAL_WORKSPACE_ID;
        const timer = await transaction.getFirstAsync<ActiveTimerRow>(
          `SELECT at.workspace_id, at.item_id, i.type AS item_type, i.title,
                  at.started_at, at.running_since, at.elapsed_seconds
             FROM active_timer at
             JOIN items i ON i.id = at.item_id
            WHERE at.workspace_id = ?`,
          [workspaceId],
        );
        if (!timer) throw new Error('No hay ningún cronómetro activo.');
        await trackableItem(transaction, timer.item_id);
        const endedAt =
          command.payload.endedAt ?? command.issuedAt ?? Date.now();
        const runningSegments =
          timer.running_since === null
            ? []
            : splitRunningInterval(timer.running_since, endedAt);
        const runningSeconds = runningSegments.reduce(
          (total, segment) => total + segment.seconds,
          0,
        );
        await addTimerSegments(transaction, workspaceId, runningSegments);
        const elapsedSeconds = Math.max(
          1,
          timer.elapsed_seconds + runningSeconds,
        );
        const storedSegments =
          await transaction.getAllAsync<ActiveTimerSegmentRow>(
            `SELECT local_date, elapsed_seconds
               FROM active_timer_segments
              WHERE workspace_id = ?
              ORDER BY local_date`,
            [workspaceId],
          );
        const secondsByDate = new Map(
          storedSegments.map((segment) => [
            segment.local_date,
            segment.elapsed_seconds,
          ]),
        );
        const segmentedSeconds = storedSegments.reduce(
          (total, segment) => total + segment.elapsed_seconds,
          0,
        );
        const unsegmentedSeconds = Math.max(
          0,
          elapsedSeconds - segmentedSeconds,
        );
        if (unsegmentedSeconds > 0) {
          secondsByDate.set(
            command.payload.localDate,
            (secondsByDate.get(command.payload.localDate) ?? 0) +
              unsegmentedSeconds,
          );
        }

        const sessionId = `timer:${timer.item_id}:${timer.started_at}`;
        let measurementId = '';
        for (const [localDate, seconds] of [...secondsByDate].sort(
          ([left], [right]) => left.localeCompare(right),
        )) {
          if (seconds <= 0) continue;
          const segmentMeasurementId = createUuid();
          if (!measurementId) measurementId = segmentMeasurementId;
          await transaction.runAsync(
            `INSERT INTO measurements
              (id, item_id, occurrence_key, session_id, schedule_version_id, slot_id,
               value, operation, unit, occurred_at, local_date, started_at, ended_at,
               source, note, created_at, updated_at)
             VALUES (?, ?, NULL, ?, NULL, NULL, ?, 'add', 'seconds', ?, ?, ?, ?,
                     'timer', NULL, ?, ?)`,
            [
              segmentMeasurementId,
              timer.item_id,
              sessionId,
              seconds,
              endedAt,
              localDate,
              timer.started_at,
              endedAt,
              endedAt,
              endedAt,
            ],
          );
          await recordMutation(transaction, {
            commandId: command.commandId,
            deviceId: command.deviceId,
            workspaceId,
            entityType: 'measurement',
            entityId: segmentMeasurementId,
            operation: 'upsert',
            payload: {
              id: segmentMeasurementId,
              itemId: timer.item_id,
              sessionId,
              value: seconds,
              operation: 'add',
              unit: 'seconds',
              occurredAt: endedAt,
              localDate,
              startedAt: timer.started_at,
              endedAt,
              source: 'timer',
            },
            now: endedAt,
          });
        }
        if (!measurementId) {
          throw new Error('No se pudo dividir la sesión guardada.');
        }
        await transaction.runAsync(
          'DELETE FROM active_timer WHERE workspace_id = ?',
          [workspaceId],
        );
        return { measurementId, itemId: timer.item_id, elapsedSeconds };
      },
    );
  }

  recordManualDuration(
    command: CommandEnvelope<RecordManualDurationInput>,
  ): Promise<CommandExecution<{ measurementId: string }>> {
    assertLocalDate(command.payload.localDate);
    if (
      !Number.isFinite(command.payload.seconds) ||
      command.payload.seconds <= 0
    ) {
      throw new RangeError('La duración debe ser mayor que cero.');
    }
    return executeIdempotentCommand(
      this.database,
      {
        id: command.commandId,
        name: 'progress.record_manual_duration',
        payload: command.payload,
        issuedAt: command.issuedAt,
      },
      async (transaction) => {
        const item = await trackableItem(transaction, command.payload.itemId);
        const workspaceId = command.payload.workspaceId ?? LOCAL_WORKSPACE_ID;
        if (item.workspace_id !== workspaceId) {
          throw new Error('El elemento no pertenece a este espacio.');
        }
        const now =
          command.payload.occurredAt ?? command.issuedAt ?? Date.now();
        const measurementId = createUuid();
        const seconds = Math.round(command.payload.seconds);
        await transaction.runAsync(
          `INSERT INTO measurements
            (id, item_id, occurrence_key, session_id, schedule_version_id, slot_id,
             value, operation, unit, occurred_at, local_date, started_at, ended_at,
             source, note, created_at, updated_at)
           VALUES (?, ?, NULL, NULL, NULL, NULL, ?, 'add', 'seconds', ?, ?, NULL,
                   NULL, 'app', NULL, ?, ?)`,
          [
            measurementId,
            command.payload.itemId,
            seconds,
            now,
            command.payload.localDate,
            now,
            now,
          ],
        );
        await recordMutation(transaction, {
          commandId: command.commandId,
          deviceId: command.deviceId,
          workspaceId,
          entityType: 'measurement',
          entityId: measurementId,
          operation: 'upsert',
          payload: {
            id: measurementId,
            itemId: command.payload.itemId,
            value: seconds,
            operation: 'add',
            unit: 'seconds',
            occurredAt: now,
            localDate: command.payload.localDate,
            source: 'app',
          },
          now,
        });
        return { measurementId };
      },
    );
  }

  async resolveLegacyTimers(itemId: string | null): Promise<void> {
    await withWriteTransaction(this.database, async (transaction) => {
      const rows = await transaction.getAllAsync<LegacyTimerRow>(
        `SELECT h.item_id, h.timer_started_at
           FROM habits h
           JOIN items i ON i.id = h.item_id
          WHERE h.timer_started_at IS NOT NULL
            AND i.archived_at IS NULL
            AND i.deleted_at IS NULL
          ORDER BY h.timer_started_at, h.item_id`,
      );
      if (rows.length === 0) return;
      if (itemId !== null) {
        const chosen = rows.find((row) => row.item_id === itemId);
        if (!chosen) throw new Error('La sesión heredada ya no existe.');
        const item = await trackableItem(transaction, itemId);
        const existing = await transaction.getFirstAsync<{ item_id: string }>(
          'SELECT item_id FROM active_timer WHERE workspace_id = ?',
          [item.workspace_id],
        );
        if (existing) throw new Error('Ya hay un cronómetro activo.');
        await transaction.runAsync(
          `INSERT INTO active_timer
            (workspace_id, item_id, started_at, running_since, elapsed_seconds, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`,
          [
            item.workspace_id,
            itemId,
            chosen.timer_started_at,
            chosen.timer_started_at,
            chosen.timer_started_at,
            chosen.timer_started_at,
          ],
        );
      }
      await transaction.runAsync(
        'UPDATE habits SET timer_started_at = NULL WHERE timer_started_at IS NOT NULL',
      );
    });
  }

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
