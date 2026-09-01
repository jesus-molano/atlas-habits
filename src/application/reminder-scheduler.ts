import type { SQLiteDatabase } from 'expo-sqlite';

import { createUuid } from '../data/uuid';
import {
  cancelOneShotReminderAsync,
  getScheduledNotificationIdsAsync,
  scheduleOneShotReminderAsync,
  type OneShotReminderInput,
} from '../platform/notifications';

import {
  buildAtlasReminderPlan,
  type ReminderMeasurement,
  type ReminderOccurrenceOverride,
  type ReminderPause,
  type ReminderRoutineState,
  type ReminderScheduleDefinition,
  type ReminderScheduleRuleType,
  type ReminderTaskState,
} from './reminder-plan';

const MANAGED_NOTIFICATION_PREFIX = 'atlas-reminder-';
const SNOOZED_NOTIFICATION_PREFIX = 'atlas-snooze-';
const DEFAULT_HORIZON_DAYS = 35;
export const REMINDERS_ENABLED_STORAGE_KEY = '@atlas/reminders-enabled/v1';

type DefinitionRow = Readonly<{
  reminder_id: string;
  item_id: string;
  item_type: 'habit' | 'task' | 'routine';
  title: string;
  schedule_slot_id: string | null;
  local_time: string | null;
  offset_minutes: number;
  snooze_minutes: number;
  schedule_version_id: string;
  version_number: number;
  effective_from: string;
  effective_until: string | null;
  rule_type: ReminderScheduleRuleType;
  rule_json: string;
  task_due_at: number | null;
  measurement_type: 'boolean' | 'quantity' | 'duration' | null;
  goal_target: number | null;
  goal_aggregation: 'count' | 'sum' | 'duration' | null;
}>;

type PauseRow = Readonly<{
  item_id: string;
  start_date: string;
  end_date: string | null;
}>;

type MeasurementRow = Readonly<{
  id: string;
  item_id: string;
  occurrence_key: string | null;
  session_id: string | null;
  value: number;
  operation: 'add' | 'set';
  occurred_at: number;
  local_date: string;
}>;

type OverrideRow = Readonly<{
  item_id: string;
  occurrence_key: string;
  local_date: string;
  state: ReminderOccurrenceOverride['state'];
}>;

type TaskStateRow = Readonly<{
  item_id: string;
  local_date: string;
  status: ReminderTaskState['status'];
}>;

type RoutineStateRow = Readonly<{
  item_id: string;
  local_date: string;
  status: ReminderRoutineState['status'];
}>;

type DeliveryRow = Readonly<{
  reminder_rule_id: string;
  occurrence_key: string;
  scheduled_at: number;
  notification_id: string;
}>;

export type AtlasReminderSchedulerDependencies = Readonly<{
  listScheduledNotificationIds: () => Promise<readonly string[]>;
  scheduleOneShot: (input: OneShotReminderInput) => Promise<string>;
  cancelOneShot: (notificationId: string) => Promise<void>;
  createId: () => string;
}>;

export type RescheduleAtlasRemindersOptions = Readonly<{
  database: SQLiteDatabase;
  now?: Date;
  horizonDays?: number;
  dependencies?: Partial<AtlasReminderSchedulerDependencies>;
  enabled?: boolean;
}>;

export type RescheduleAtlasRemindersResult = Readonly<{
  desired: number;
  scheduled: number;
  cancelled: number;
}>;

const defaultDependencies: AtlasReminderSchedulerDependencies = {
  listScheduledNotificationIds: getScheduledNotificationIdsAsync,
  scheduleOneShot: scheduleOneShotReminderAsync,
  cancelOneShot: cancelOneShotReminderAsync,
  createId: createUuid,
};

function parseRule(value: string): Readonly<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Readonly<Record<string, unknown>>)
      : {};
  } catch {
    return {};
  }
}

function mapDefinition(row: DefinitionRow): ReminderScheduleDefinition {
  return {
    reminderId: row.reminder_id,
    itemId: row.item_id,
    itemType: row.item_type,
    title: row.title,
    scheduleSlotId: row.schedule_slot_id,
    localTime: row.local_time,
    offsetMinutes: row.offset_minutes,
    snoozeMinutes: row.snooze_minutes,
    scheduleVersionId: row.schedule_version_id,
    versionNumber: row.version_number,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    ruleType: row.rule_type,
    rule: parseRule(row.rule_json),
    taskDueAt: row.task_due_at,
    measurementType: row.measurement_type,
    goalTarget: Math.max(1, row.goal_target ?? 1),
    goalAggregation: row.goal_aggregation ?? 'sum',
  };
}

async function loadDefinitions(
  database: SQLiteDatabase,
): Promise<ReminderScheduleDefinition[]> {
  const rows = await database.getAllAsync<DefinitionRow>(
    `SELECT
       rr.id AS reminder_id,
       i.id AS item_id,
       i.type AS item_type,
       i.title,
       rr.schedule_slot_id,
       COALESCE(
         rr.local_time,
         linked_slot.local_time,
         (SELECT fallback_slot.local_time
            FROM schedule_slots fallback_slot
           WHERE fallback_slot.schedule_version_id = sv.id
             AND fallback_slot.local_time IS NOT NULL
           ORDER BY fallback_slot.sort_order, fallback_slot.id
           LIMIT 1)
       ) AS local_time,
       rr.offset_minutes,
       rr.snooze_minutes,
       sv.id AS schedule_version_id,
       sv.version_number,
       sv.effective_from,
       sv.effective_until,
       sv.rule_type,
       sv.rule_json,
       t.due_at AS task_due_at,
       h.measurement_type,
       (SELECT sg.target_value
          FROM schedule_goals sg
         WHERE sg.schedule_version_id = sv.id
           AND (sg.slot_id = rr.schedule_slot_id OR sg.slot_id IS NULL)
         ORDER BY CASE WHEN sg.slot_id = rr.schedule_slot_id THEN 0 ELSE 1 END, sg.id
         LIMIT 1) AS goal_target,
       (SELECT sg.aggregation
          FROM schedule_goals sg
         WHERE sg.schedule_version_id = sv.id
           AND (sg.slot_id = rr.schedule_slot_id OR sg.slot_id IS NULL)
         ORDER BY CASE WHEN sg.slot_id = rr.schedule_slot_id THEN 0 ELSE 1 END, sg.id
         LIMIT 1) AS goal_aggregation
     FROM reminder_rules rr
     JOIN items i ON i.id = rr.item_id
     JOIN schedules s ON s.item_id = i.id AND s.retired_at IS NULL
     JOIN schedule_versions sv ON sv.schedule_id = s.id
     LEFT JOIN schedule_slots linked_slot ON linked_slot.id = rr.schedule_slot_id
     LEFT JOIN habits h ON h.item_id = i.id
     LEFT JOIN tasks t ON t.item_id = i.id
     WHERE rr.enabled = 1
       AND rr.deleted_at IS NULL
       AND i.archived_at IS NULL
       AND i.deleted_at IS NULL
     ORDER BY rr.id, sv.version_number`,
  );
  return rows.map(mapDefinition);
}

async function loadPlanState(database: SQLiteDatabase): Promise<{
  pauses: ReminderPause[];
  measurements: ReminderMeasurement[];
  overrides: ReminderOccurrenceOverride[];
  taskStates: ReminderTaskState[];
  routineStates: ReminderRoutineState[];
}> {
  const [pauseRows, measurementRows, overrideRows, taskRows, routineRows] =
    await Promise.all([
      database.getAllAsync<PauseRow>(
        'SELECT item_id, start_date, end_date FROM item_pauses',
      ),
      database.getAllAsync<MeasurementRow>(
        `SELECT id, item_id, occurrence_key, session_id, value, operation,
                occurred_at, local_date
           FROM measurements
          WHERE deleted_at IS NULL`,
      ),
      database.getAllAsync<OverrideRow>(
        `SELECT item_id, occurrence_key, local_date, state
           FROM occurrence_overrides`,
      ),
      database.getAllAsync<TaskStateRow>(
        `SELECT task_id AS item_id, local_date, status
           FROM task_instances`,
      ),
      database.getAllAsync<RoutineStateRow>(
        `SELECT routine_id AS item_id, local_date, status
           FROM routine_runs`,
      ),
    ]);
  return {
    pauses: pauseRows.map((row) => ({
      itemId: row.item_id,
      startDate: row.start_date,
      endDate: row.end_date,
    })),
    measurements: measurementRows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      occurrenceKey: row.occurrence_key,
      sessionId: row.session_id,
      value: row.value,
      operation: row.operation,
      occurredAt: row.occurred_at,
      localDate: row.local_date,
    })),
    overrides: overrideRows.map((row) => ({
      itemId: row.item_id,
      occurrenceKey: row.occurrence_key,
      localDate: row.local_date,
      state: row.state,
    })),
    taskStates: taskRows.map((row) => ({
      itemId: row.item_id,
      localDate: row.local_date,
      status: row.status,
    })),
    routineStates: routineRows.map((row) => ({
      itemId: row.item_id,
      localDate: row.local_date,
      status: row.status,
    })),
  };
}

async function forgetDelivery(
  database: SQLiteDatabase,
  notificationId: string,
): Promise<void> {
  await database.runAsync(
    `DELETE FROM reminder_deliveries
      WHERE notification_id = ? AND delivered_at IS NULL`,
    [notificationId],
  );
}

async function rememberDelivery(
  database: SQLiteDatabase,
  entry: ReturnType<typeof buildAtlasReminderPlan>[number],
  notificationId: string,
  createId: () => string,
): Promise<void> {
  await database.runAsync(
    `INSERT OR IGNORE INTO reminder_deliveries
      (id, reminder_rule_id, occurrence_key, scheduled_at, notification_id)
     VALUES (?, ?, ?, ?, ?)`,
    [
      createId(),
      entry.reminderId,
      entry.occurrenceId,
      entry.fireAt.getTime(),
      notificationId,
    ],
  );
}

/**
 * Reconciles Atlas-owned one-shot alarms. Normal refreshes preserve snoozes.
 * Disabling the local master switch cancels reminders and snoozes together.
 * Database writes happen after the native operation they describe, so a failed
 * schedule or cancellation is never recorded as successful.
 */
export async function rescheduleAtlasRemindersAsync({
  database,
  now = new Date(),
  horizonDays = DEFAULT_HORIZON_DAYS,
  dependencies,
  enabled = true,
}: RescheduleAtlasRemindersOptions): Promise<RescheduleAtlasRemindersResult> {
  const services: AtlasReminderSchedulerDependencies = {
    ...defaultDependencies,
    ...dependencies,
  };
  const [definitions, state, scheduledIds, deliveryRows] = await Promise.all([
    loadDefinitions(database),
    loadPlanState(database),
    services.listScheduledNotificationIds(),
    database.getAllAsync<DeliveryRow>(
      `SELECT reminder_rule_id, occurrence_key, scheduled_at, notification_id
         FROM reminder_deliveries
        WHERE notification_id IS NOT NULL
          AND delivered_at IS NULL
          AND acted_at IS NULL`,
    ),
  ]);
  const plan = enabled
    ? buildAtlasReminderPlan({
        definitions,
        ...state,
        now,
        horizonDays,
      })
    : [];
  const desiredById = new Map(
    plan.map((entry) => [entry.notificationId, entry]),
  );
  const isManagedId = (notificationId: string) =>
    notificationId.startsWith(MANAGED_NOTIFICATION_PREFIX) ||
    (!enabled && notificationId.startsWith(SNOOZED_NOTIFICATION_PREFIX));
  const actualManaged = new Set(scheduledIds.filter(isManagedId));
  const knownDeliveries = new Set(
    deliveryRows.map((row) => row.notification_id).filter(isManagedId),
  );

  let cancelled = 0;
  for (const notificationId of new Set([
    ...actualManaged,
    ...knownDeliveries,
  ])) {
    if (desiredById.has(notificationId)) continue;
    if (actualManaged.has(notificationId)) {
      await services.cancelOneShot(notificationId);
      cancelled += 1;
    }
    await forgetDelivery(database, notificationId);
  }

  let scheduled = 0;
  for (const entry of plan) {
    if (actualManaged.has(entry.notificationId)) {
      if (!knownDeliveries.has(entry.notificationId)) {
        await rememberDelivery(
          database,
          entry,
          entry.notificationId,
          services.createId,
        );
      }
      continue;
    }

    const notificationId = await services.scheduleOneShot({
      notificationId: entry.notificationId,
      reminderId: entry.reminderId,
      targetKind: entry.targetKind,
      targetId: entry.targetId,
      occurrenceId: entry.occurrenceId,
      title: entry.title,
      body: entry.body,
      fireAt: entry.fireAt,
      snoozeMinutes: entry.snoozeMinutes,
    });
    try {
      await rememberDelivery(
        database,
        entry,
        notificationId,
        services.createId,
      );
    } catch (error) {
      await services.cancelOneShot(notificationId).catch(() => undefined);
      throw error;
    }
    scheduled += 1;
  }

  return { desired: plan.length, scheduled, cancelled };
}
