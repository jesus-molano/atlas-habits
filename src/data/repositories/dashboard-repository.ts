import type { SQLiteDatabase } from 'expo-sqlite';

import { parseStoredJson } from '../canonical-json';
import { assertLocalDate } from '../local-date';
import {
  LOCAL_WORKSPACE_ID,
  type DashboardItem,
  type DashboardMeasurement,
  type DashboardOccurrenceOverride,
  type DashboardRoutineRun,
  type DashboardScheduleGoal,
  type DashboardScheduleSlot,
  type DashboardScheduleVersion,
  type DashboardSnapshot,
  type DashboardTaskInstance,
  type ItemType,
  type MeasurementType,
  type ScheduleRuleType,
} from '../types';

type DashboardItemRow = {
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
  category_name: string | null;
  category_color: string | null;
  tag_ids_json: string;
  is_paused: number;
  subtype_json: string;
};

type ScheduleVersionRow = {
  id: string;
  schedule_id: string;
  item_id: string;
  timezone: string;
  version_number: number;
  effective_from: string;
  effective_until: string | null;
  rule_type: ScheduleRuleType;
  rule_json: string;
  grace_minutes: number;
};

type ScheduleSlotRow = {
  id: string;
  schedule_version_id: string;
  slot_key: string;
  label: string | null;
  local_time: string | null;
  sort_order: number;
};

type ScheduleGoalRow = {
  id: string;
  schedule_version_id: string;
  slot_id: string | null;
  measurement_type: MeasurementType;
  aggregation: DashboardScheduleGoal['aggregation'];
  comparison: DashboardScheduleGoal['comparison'];
  target_value: number;
  unit: string | null;
};

type MeasurementRow = {
  id: string;
  item_id: string;
  occurrence_key: string | null;
  session_id: string | null;
  schedule_version_id: string | null;
  slot_id: string | null;
  value: number;
  operation: DashboardMeasurement['operation'];
  unit: string | null;
  occurred_at: number;
  local_date: string;
  note: string | null;
};

type OverrideRow = {
  id: string;
  item_id: string;
  occurrence_key: string;
  local_date: string;
  slot_id: string | null;
  state: DashboardOccurrenceOverride['state'];
  value: number | null;
  note: string | null;
  updated_at: number;
};

type TaskInstanceRow = {
  id: string;
  task_id: string;
  occurrence_key: string;
  local_date: string;
  scheduled_for: number | null;
  due_at: number | null;
  deadline_at: number | null;
  status: DashboardTaskInstance['status'];
  completed_at: number | null;
  snoozed_until: number | null;
};

type RoutineRunRow = {
  id: string;
  routine_id: string;
  occurrence_key: string | null;
  local_date: string;
  status: DashboardRoutineRun['status'];
  started_at: number;
  finished_at: number | null;
};

export class DashboardRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  async loadDay(
    localDate: string,
    workspaceId = LOCAL_WORKSPACE_ID,
  ): Promise<DashboardSnapshot> {
    assertLocalDate(localDate);
    const localDayEnd = new Date(`${localDate}T23:59:59.999`).getTime();

    const [
      itemRows,
      scheduleRows,
      slotRows,
      goalRows,
      measurementRows,
      overrideRows,
      taskRows,
      routineRows,
    ] = await Promise.all([
      this.database.getAllAsync<DashboardItemRow>(
        `SELECT
           i.id, i.workspace_id, i.type, i.title, i.notes, i.color, i.icon,
           i.category_id, COALESCE(dl.sort_order, i.sort_order) AS sort_order,
           i.created_at, i.updated_at, i.archived_at, i.deleted_at,
           c.name AS category_name, c.color AS category_color,
           (SELECT COALESCE(json_group_array(it.tag_id), '[]')
              FROM item_tags it JOIN tags t ON t.id = it.tag_id
             WHERE it.item_id = i.id AND t.deleted_at IS NULL) AS tag_ids_json,
           EXISTS(
             SELECT 1 FROM item_pauses p
              WHERE p.item_id = i.id
                AND p.start_date <= ?
                AND (p.end_date IS NULL OR p.end_date >= ?)
           ) AS is_paused,
           CASE i.type
             WHEN 'habit' THEN json_object(
               'measurementType', h.measurement_type,
               'unit', h.unit,
               'defaultValue', h.default_value,
               'timerStartedAt', h.timer_started_at)
             WHEN 'task' THEN json_object(
               'priority', t.priority,
               'allDay', t.all_day,
               'dueAt', t.due_at,
               'deadlineAt', t.deadline_at)
             WHEN 'routine' THEN json_object('completionPolicy', r.completion_policy)
           END AS subtype_json
         FROM items i
         LEFT JOIN categories c ON c.id = i.category_id AND c.deleted_at IS NULL
         LEFT JOIN habits h ON h.item_id = i.id
         LEFT JOIN tasks t ON t.item_id = i.id
         LEFT JOIN routines r ON r.item_id = i.id
         LEFT JOIN dashboard_layout dl
           ON dl.workspace_id = i.workspace_id AND dl.item_id = i.id
         WHERE i.workspace_id = ?
           AND i.archived_at IS NULL
           AND i.deleted_at IS NULL
           AND COALESCE(dl.hidden, 0) = 0
         ORDER BY COALESCE(dl.section_key, 'default'),
                  COALESCE(dl.sort_order, i.sort_order), i.created_at`,
        [localDate, localDate, workspaceId],
      ),
      this.database.getAllAsync<ScheduleVersionRow>(
        `SELECT sv.id, sv.schedule_id, s.item_id, s.timezone, sv.version_number,
                sv.effective_from, sv.effective_until, sv.rule_type,
                sv.rule_json, sv.grace_minutes
         FROM schedule_versions sv
         JOIN schedules s ON s.id = sv.schedule_id
         JOIN items i ON i.id = s.item_id
         WHERE i.workspace_id = ?
           AND i.archived_at IS NULL AND i.deleted_at IS NULL
           AND s.retired_at IS NULL
           AND sv.effective_from <= ?
           AND (sv.effective_until IS NULL OR sv.effective_until >= ?)
         ORDER BY s.item_id, sv.version_number`,
        [workspaceId, localDate, localDate],
      ),
      this.database.getAllAsync<ScheduleSlotRow>(
        `SELECT ss.id, ss.schedule_version_id, ss.slot_key, ss.label,
                ss.local_time, ss.sort_order
         FROM schedule_slots ss
         JOIN schedule_versions sv ON sv.id = ss.schedule_version_id
         JOIN schedules s ON s.id = sv.schedule_id
         JOIN items i ON i.id = s.item_id
         WHERE i.workspace_id = ? AND i.archived_at IS NULL AND i.deleted_at IS NULL
           AND s.retired_at IS NULL
           AND sv.effective_from <= ?
           AND (sv.effective_until IS NULL OR sv.effective_until >= ?)
         ORDER BY ss.schedule_version_id, ss.sort_order`,
        [workspaceId, localDate, localDate],
      ),
      this.database.getAllAsync<ScheduleGoalRow>(
        `SELECT sg.id, sg.schedule_version_id, sg.slot_id, sg.measurement_type,
                sg.aggregation, sg.comparison, sg.target_value, sg.unit
         FROM schedule_goals sg
         JOIN schedule_versions sv ON sv.id = sg.schedule_version_id
         JOIN schedules s ON s.id = sv.schedule_id
         JOIN items i ON i.id = s.item_id
         WHERE i.workspace_id = ? AND i.archived_at IS NULL AND i.deleted_at IS NULL
           AND s.retired_at IS NULL
           AND sv.effective_from <= ?
           AND (sv.effective_until IS NULL OR sv.effective_until >= ?)
         ORDER BY sg.schedule_version_id, sg.id`,
        [workspaceId, localDate, localDate],
      ),
      this.database.getAllAsync<MeasurementRow>(
        `SELECT m.id, m.item_id, m.occurrence_key, m.schedule_version_id,
                m.session_id, m.slot_id, m.value, m.operation, m.unit,
                m.occurred_at, m.local_date, m.note
         FROM measurements m
         JOIN items i ON i.id = m.item_id
         WHERE i.workspace_id = ? AND m.local_date = ? AND m.deleted_at IS NULL
         ORDER BY m.occurred_at`,
        [workspaceId, localDate],
      ),
      this.database.getAllAsync<OverrideRow>(
        `SELECT o.id, o.item_id, o.occurrence_key, o.local_date, o.slot_id, o.state,
                o.value, o.note, o.updated_at
         FROM occurrence_overrides o
         JOIN items i ON i.id = o.item_id
         WHERE i.workspace_id = ? AND o.local_date = ?`,
        [workspaceId, localDate],
      ),
      this.database.getAllAsync<TaskInstanceRow>(
        `SELECT ti.id, ti.task_id, ti.occurrence_key, ti.local_date,
                ti.scheduled_for, ti.due_at, ti.deadline_at, ti.status,
                ti.completed_at, ti.snoozed_until
         FROM task_instances ti
         JOIN items i ON i.id = ti.task_id
         WHERE i.workspace_id = ? AND ti.local_date = ?
         ORDER BY ti.scheduled_for, ti.due_at`,
        [workspaceId, localDate],
      ),
      this.database.getAllAsync<RoutineRunRow>(
        `SELECT rr.id, rr.routine_id, rr.occurrence_key, rr.local_date,
                rr.status, rr.started_at, rr.finished_at
         FROM routine_runs rr
         JOIN items i ON i.id = rr.routine_id
         WHERE i.workspace_id = ? AND rr.local_date = ?
         ORDER BY rr.started_at`,
        [workspaceId, localDate],
      ),
    ]);

    return {
      localDate,
      items: itemRows
        .filter((row) => row.created_at <= localDayEnd)
        .map(mapItem),
      scheduleVersions: scheduleRows.map(mapScheduleVersion),
      scheduleSlots: slotRows.map(mapScheduleSlot),
      scheduleGoals: goalRows.map(mapScheduleGoal),
      measurements: measurementRows.map(mapMeasurement),
      overrides: overrideRows.map(mapOverride),
      taskInstances: taskRows.map(mapTaskInstance),
      routineRuns: routineRows.map(mapRoutineRun),
    };
  }
}

function mapItem(row: DashboardItemRow): DashboardItem {
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
    categoryName: row.category_name,
    categoryColor: row.category_color,
    tagIds: parseStoredJson<string[]>(
      row.tag_ids_json,
      `tags for item ${row.id}`,
    ),
    isPaused: row.is_paused === 1,
    subtypeJson: row.subtype_json,
  };
}

function mapScheduleVersion(row: ScheduleVersionRow): DashboardScheduleVersion {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    itemId: row.item_id,
    timezone: row.timezone,
    versionNumber: row.version_number,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    ruleType: row.rule_type,
    rule: parseStoredJson<Record<string, unknown>>(
      row.rule_json,
      `schedule rule ${row.id}`,
    ),
    graceMinutes: row.grace_minutes,
  };
}

function mapScheduleSlot(row: ScheduleSlotRow): DashboardScheduleSlot {
  return {
    id: row.id,
    scheduleVersionId: row.schedule_version_id,
    key: row.slot_key,
    label: row.label,
    localTime: row.local_time,
    sortOrder: row.sort_order,
  };
}

function mapScheduleGoal(row: ScheduleGoalRow): DashboardScheduleGoal {
  return {
    id: row.id,
    scheduleVersionId: row.schedule_version_id,
    slotId: row.slot_id,
    measurementType: row.measurement_type,
    aggregation: row.aggregation,
    comparison: row.comparison,
    targetValue: row.target_value,
    unit: row.unit,
  };
}

function mapMeasurement(row: MeasurementRow): DashboardMeasurement {
  return {
    id: row.id,
    itemId: row.item_id,
    occurrenceKey: row.occurrence_key,
    sessionId: row.session_id,
    scheduleVersionId: row.schedule_version_id,
    slotId: row.slot_id,
    value: row.value,
    operation: row.operation,
    unit: row.unit,
    occurredAt: row.occurred_at,
    localDate: row.local_date,
    note: row.note,
  };
}

function mapOverride(row: OverrideRow): DashboardOccurrenceOverride {
  return {
    id: row.id,
    itemId: row.item_id,
    occurrenceKey: row.occurrence_key,
    localDate: row.local_date,
    slotId: row.slot_id,
    state: row.state,
    value: row.value,
    note: row.note,
    updatedAt: row.updated_at,
  };
}

function mapTaskInstance(row: TaskInstanceRow): DashboardTaskInstance {
  return {
    id: row.id,
    taskId: row.task_id,
    occurrenceKey: row.occurrence_key,
    localDate: row.local_date,
    scheduledFor: row.scheduled_for,
    dueAt: row.due_at,
    deadlineAt: row.deadline_at,
    status: row.status,
    completedAt: row.completed_at,
    snoozedUntil: row.snoozed_until,
  };
}

function mapRoutineRun(row: RoutineRunRow): DashboardRoutineRun {
  return {
    id: row.id,
    routineId: row.routine_id,
    occurrenceKey: row.occurrence_key,
    localDate: row.local_date,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}
