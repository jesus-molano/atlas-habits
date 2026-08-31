import type { SQLiteDatabase } from 'expo-sqlite';

import {
  createUuid,
  executeIdempotentCommand,
  getCommandGateway,
  getDatabase,
  recordMutation,
  type SqlExecutor,
} from '../data';
import type {
  CommandDispatchResult,
  CommandEnvelope,
  CommandGateway as PlatformCommandGateway,
} from '../platform/commands';
import {
  cancelOneShotReminderAsync,
  scheduleOneShotReminderAsync,
} from '../platform/notifications';

import { localDateFromDate, localDateFromOccurrenceKey } from './date-time';
import { getAtlasDeviceId } from './device-identity';
import { rescheduleAtlasRemindersAsync } from './reminder-scheduler';

type NotificationIdRow = { notification_id: string };

type HabitCompletionDefinitionRow = Readonly<{
  workspace_id: string;
  measurement_type: 'boolean' | 'quantity' | 'duration';
  unit: string | null;
  default_value: number;
  schedule_version_id: string | null;
  goal_target: number | null;
  goal_unit: string | null;
}>;

type ReminderSlotRow = Readonly<{ schedule_slot_id: string | null }>;

type SQLitePlatformCommandGatewayDependencies = Readonly<{
  getDatabase: typeof getDatabase;
  getCommandGateway: typeof getCommandGateway;
  rescheduleReminders: typeof rescheduleAtlasRemindersAsync;
}>;

const defaultDependencies: SQLitePlatformCommandGatewayDependencies = {
  getDatabase,
  getCommandGateway,
  rescheduleReminders: rescheduleAtlasRemindersAsync,
};

function dispatchStatus(replayed: boolean): CommandDispatchResult {
  return { status: replayed ? 'duplicate' : 'applied' };
}

async function cancelOccurrenceNotifications(
  database: SQLiteDatabase,
  occurrenceKey: string,
): Promise<void> {
  const rows = await database.getAllAsync<NotificationIdRow>(
    `SELECT DISTINCT notification_id
     FROM reminder_deliveries
     WHERE occurrence_key = ? AND notification_id IS NOT NULL`,
    [occurrenceKey],
  );
  await Promise.all(
    rows.map((row) =>
      cancelOneShotReminderAsync(row.notification_id).catch(() => undefined),
    ),
  );
}

async function habitCompletionDefinition(
  database: SqlExecutor,
  itemId: string,
  occurrenceKey: string,
  localDate: string,
): Promise<HabitCompletionDefinitionRow & { scheduleSlotId: string | null }> {
  const reminderSlot = await database.getFirstAsync<ReminderSlotRow>(
    `SELECT rr.schedule_slot_id
       FROM reminder_deliveries rd
       JOIN reminder_rules rr ON rr.id = rd.reminder_rule_id
      WHERE rd.occurrence_key = ?
        AND rr.item_id = ?
      ORDER BY rd.scheduled_at DESC
      LIMIT 1`,
    [occurrenceKey, itemId],
  );
  const scheduleSlotId = reminderSlot?.schedule_slot_id ?? null;
  const definition = await database.getFirstAsync<HabitCompletionDefinitionRow>(
    `SELECT
       i.workspace_id,
       h.measurement_type,
       h.unit,
       h.default_value,
       sv.id AS schedule_version_id,
       (SELECT sg.target_value
          FROM schedule_goals sg
         WHERE sg.schedule_version_id = sv.id
           AND (sg.slot_id = ? OR sg.slot_id IS NULL)
         ORDER BY CASE WHEN sg.slot_id = ? THEN 0 ELSE 1 END, sg.id
         LIMIT 1) AS goal_target,
       (SELECT sg.unit
          FROM schedule_goals sg
         WHERE sg.schedule_version_id = sv.id
           AND (sg.slot_id = ? OR sg.slot_id IS NULL)
         ORDER BY CASE WHEN sg.slot_id = ? THEN 0 ELSE 1 END, sg.id
         LIMIT 1) AS goal_unit
     FROM habits h
     JOIN items i ON i.id = h.item_id
     LEFT JOIN schedules s
       ON s.item_id = i.id AND s.retired_at IS NULL
     LEFT JOIN schedule_versions sv
       ON sv.schedule_id = s.id
      AND sv.effective_from <= ?
      AND (sv.effective_until IS NULL OR sv.effective_until >= ?)
     WHERE h.item_id = ?
       AND i.archived_at IS NULL
       AND i.deleted_at IS NULL
     ORDER BY sv.version_number DESC
     LIMIT 1`,
    [
      scheduleSlotId,
      scheduleSlotId,
      scheduleSlotId,
      scheduleSlotId,
      localDate,
      localDate,
      itemId,
    ],
  );
  if (!definition) throw new Error(`Habit ${itemId} does not exist.`);
  const validSlot =
    scheduleSlotId && definition.schedule_version_id
      ? await database.getFirstAsync<{ id: string }>(
          `SELECT id FROM schedule_slots
            WHERE id = ? AND schedule_version_id = ?`,
          [scheduleSlotId, definition.schedule_version_id],
        )
      : null;
  return {
    ...definition,
    scheduleSlotId: validSlot?.id ?? null,
  };
}

async function recordHabitCompletion(
  database: SQLiteDatabase,
  envelope: CommandEnvelope,
  deviceId: string,
  localDate: string,
  issuedAt: number,
) {
  if (envelope.command.type !== 'occurrence.complete') {
    throw new Error('Expected an occurrence completion command.');
  }
  const itemId = envelope.command.targetId;
  const occurrenceKey = envelope.command.occurrenceId;
  const receiptPayload = { itemId, occurrenceKey, localDate };
  return executeIdempotentCommand(
    database,
    {
      id: envelope.idempotencyKey,
      name: 'platform.habit.complete',
      payload: receiptPayload,
      issuedAt,
    },
    async (transaction) => {
      const measurementId = `platform:${envelope.idempotencyKey}`;
      const existing = await transaction.getFirstAsync<{ id: string }>(
        'SELECT id FROM measurements WHERE id = ? AND deleted_at IS NULL',
        [measurementId],
      );
      if (existing) return { measurementId };

      const definition = await habitCompletionDefinition(
        transaction,
        itemId,
        occurrenceKey,
        localDate,
      );
      const value =
        definition.measurement_type === 'boolean'
          ? 1
          : Math.max(1, definition.goal_target ?? definition.default_value);
      const sessionId = `platform:${envelope.idempotencyKey}`;
      const payload = {
        id: measurementId,
        itemId,
        occurrenceKey,
        sessionId,
        scheduleVersionId: definition.schedule_version_id,
        slotId: definition.scheduleSlotId,
        value,
        operation: 'add' as const,
        unit: definition.goal_unit ?? definition.unit,
        occurredAt: issuedAt,
        localDate,
        source: envelope.source,
      };
      await transaction.runAsync(
        `INSERT INTO measurements
          (id, item_id, occurrence_key, session_id, schedule_version_id, slot_id,
           value, operation, unit, occurred_at, local_date, source,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'add', ?, ?, ?, ?, ?, ?)`,
        [
          measurementId,
          itemId,
          occurrenceKey,
          sessionId,
          definition.schedule_version_id,
          definition.scheduleSlotId,
          value,
          payload.unit,
          issuedAt,
          localDate,
          envelope.source,
          issuedAt,
          issuedAt,
        ],
      );
      await recordMutation(transaction, {
        commandId: envelope.idempotencyKey,
        deviceId,
        workspaceId: definition.workspace_id,
        entityType: 'measurement',
        entityId: measurementId,
        operation: 'upsert',
        payload,
        now: issuedAt,
      });
      return { measurementId };
    },
  );
}

export class SQLitePlatformCommandGateway implements PlatformCommandGateway {
  private readonly dependencies: SQLitePlatformCommandGatewayDependencies;

  constructor(
    dependencies: Partial<SQLitePlatformCommandGatewayDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async dispatch(envelope: CommandEnvelope): Promise<CommandDispatchResult> {
    const database = await this.dependencies.getDatabase();
    const gateway = await this.dependencies.getCommandGateway();
    const deviceId = getAtlasDeviceId();
    const issuedAt = new Date(envelope.issuedAt);
    if (!Number.isFinite(issuedAt.getTime()))
      throw new Error('issuedAt is not a valid date.');
    const localDate =
      localDateFromOccurrenceKey(envelope.command.occurrenceId) ??
      localDateFromDate(issuedAt);

    if (envelope.command.type === 'occurrence.complete') {
      let replayed: boolean;
      if (envelope.command.targetKind === 'habit') {
        const result = await recordHabitCompletion(
          database,
          envelope,
          deviceId,
          localDate,
          issuedAt.getTime(),
        );
        replayed = result.replayed;
      } else if (envelope.command.targetKind === 'task') {
        const result = await gateway.progress.setTaskInstanceStatus({
          commandId: envelope.idempotencyKey,
          deviceId,
          issuedAt: issuedAt.getTime(),
          payload: {
            taskId: envelope.command.targetId,
            occurrenceKey: envelope.command.occurrenceId,
            localDate,
            status: 'completed',
            completedAt: issuedAt.getTime(),
            updatedAt: issuedAt.getTime(),
          },
        });
        replayed = result.replayed;
      } else {
        const run = await database.getFirstAsync<{ routine_run_id: string }>(
          `SELECT rrs.routine_run_id
           FROM routine_run_steps rrs
           JOIN routine_runs rr ON rr.id = rrs.routine_run_id
           WHERE rrs.step_id = ? AND rr.local_date = ? AND rr.status = 'running'
           ORDER BY rr.started_at DESC LIMIT 1`,
          [envelope.command.targetId, localDate],
        );
        if (!run) throw new Error('No hay una rutina activa para ese paso.');
        const result = await gateway.actions.updateRoutineStep({
          commandId: envelope.idempotencyKey,
          deviceId,
          issuedAt: issuedAt.getTime(),
          payload: {
            routineRunId: run.routine_run_id,
            stepId: envelope.command.targetId,
            status: 'completed',
            finishedAt: issuedAt.getTime(),
            updatedAt: issuedAt.getTime(),
          },
        });
        replayed = result.replayed;
      }
      await cancelOccurrenceNotifications(
        database,
        envelope.command.occurrenceId,
      );
      // The state mutation above is authoritative. Alarm reconciliation is
      // auxiliary and must not turn a committed completion into an error.
      await this.dependencies
        .rescheduleReminders({ database })
        .catch(() => undefined);
      return dispatchStatus(replayed);
    }

    const command = envelope.command;
    const fireAt = new Date(command.snoozeUntil);
    if (!Number.isFinite(fireAt.getTime()))
      throw new Error('snoozeUntil is not a valid date.');
    const notificationId = `atlas-snooze-${encodeURIComponent(envelope.idempotencyKey)}`;
    const titleRow = await database.getFirstAsync<{ title: string }>(
      'SELECT title FROM items WHERE id = ? AND deleted_at IS NULL',
      [command.targetId],
    );
    const payload = {
      reminderId: command.reminderId,
      reminderRuleId: command.reminderId,
      occurrenceKey: command.occurrenceId,
      notificationId,
      scheduledAt: fireAt.getTime(),
      actedAt: issuedAt.getTime(),
      action: 'snooze' as const,
      sourceNotificationId: command.sourceNotificationId,
    };
    const receipt = await executeIdempotentCommand(
      database,
      {
        id: envelope.idempotencyKey,
        name: 'platform.reminder.snooze',
        payload,
        issuedAt: issuedAt.getTime(),
      },
      async (transaction) => {
        const deliveryId = createUuid();
        await transaction.runAsync(
          `INSERT OR IGNORE INTO reminder_deliveries
            (id, reminder_rule_id, occurrence_key, scheduled_at, acted_at,
             action, notification_id)
           SELECT ?, id, ?, ?, ?, 'snooze', ?
           FROM reminder_rules
           WHERE id = ? AND deleted_at IS NULL`,
          [
            deliveryId,
            command.occurrenceId,
            fireAt.getTime(),
            issuedAt.getTime(),
            notificationId,
            command.reminderId,
          ],
        );
        await recordMutation(transaction, {
          commandId: envelope.idempotencyKey,
          deviceId,
          entityType: 'reminder_delivery',
          entityId: deliveryId,
          operation: 'upsert',
          payload: { id: deliveryId, ...payload },
          now: issuedAt.getTime(),
        });
        return { notificationId };
      },
    );

    await cancelOneShotReminderAsync(command.sourceNotificationId).catch(
      () => undefined,
    );
    await scheduleOneShotReminderAsync({
      notificationId: receipt.value.notificationId,
      reminderId: command.reminderId,
      targetKind: command.targetKind,
      targetId: command.targetId,
      occurrenceId: command.occurrenceId,
      title: titleRow?.title ?? 'Atlas',
      body: 'Recordatorio pospuesto',
      fireAt,
    });
    return dispatchStatus(receipt.replayed);
  }
}

export const atlasPlatformCommandGateway: PlatformCommandGateway =
  new SQLitePlatformCommandGateway();
