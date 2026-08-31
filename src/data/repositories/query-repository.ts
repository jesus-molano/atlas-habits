import type { SQLiteDatabase } from 'expo-sqlite';

export type TaskSubtaskDefinition = {
  id: string;
  taskId: string;
  title: string;
  sortOrder: number;
  required: boolean;
};

export type RoutineStepDefinition = {
  id: string;
  routineId: string;
  title: string;
  notes: string | null;
  sortOrder: number;
  required: boolean;
  durationSeconds: number | null;
};

export type RoutineRunStep = {
  routineRunId: string;
  stepId: string;
  title: string;
  required: boolean;
  durationSeconds: number | null;
  status: 'pending' | 'running' | 'completed' | 'skipped';
  startedAt: number | null;
  finishedAt: number | null;
  elapsedSeconds: number;
  note: string | null;
};

export type ReminderRuleRecord = {
  id: string;
  itemId: string;
  scheduleSlotId: string | null;
  enabled: boolean;
  triggerType: 'scheduled' | 'before_due' | 'after_due';
  localTime: string | null;
  offsetMinutes: number;
  exactAlarm: boolean;
  allowComplete: boolean;
  allowSnooze: boolean;
  snoozeMinutes: number;
  repeatUntilCompleted: boolean;
  repeatIntervalMinutes: number | null;
  androidNotificationKey: string | null;
};

type TaskSubtaskRow = {
  id: string;
  task_id: string;
  title: string;
  sort_order: number;
  required: number;
};

type RoutineStepRow = {
  id: string;
  routine_id: string;
  title: string;
  notes: string | null;
  sort_order: number;
  required: number;
  duration_seconds: number | null;
};

type RoutineRunStepRow = {
  routine_run_id: string;
  step_id: string;
  title: string;
  required: number;
  duration_seconds: number | null;
  status: RoutineRunStep['status'];
  started_at: number | null;
  finished_at: number | null;
  elapsed_seconds: number;
  note: string | null;
};

type ReminderRuleRow = {
  id: string;
  item_id: string;
  schedule_slot_id: string | null;
  enabled: number;
  trigger_type: ReminderRuleRecord['triggerType'];
  local_time: string | null;
  offset_minutes: number;
  exact_alarm: number;
  allow_complete: number;
  allow_snooze: number;
  snooze_minutes: number;
  repeat_until_completed: number;
  repeat_interval_minutes: number | null;
  android_notification_key: string | null;
};

export class QueryRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  async listTaskSubtasks(taskId: string): Promise<TaskSubtaskDefinition[]> {
    const rows = await this.database.getAllAsync<TaskSubtaskRow>(
      `SELECT id, task_id, title, sort_order, required
       FROM task_subtasks
       WHERE task_id = ? AND deleted_at IS NULL
       ORDER BY sort_order, created_at`,
      [taskId],
    );
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      title: row.title,
      sortOrder: row.sort_order,
      required: row.required === 1,
    }));
  }

  async listRoutineSteps(routineId: string): Promise<RoutineStepDefinition[]> {
    const rows = await this.database.getAllAsync<RoutineStepRow>(
      `SELECT id, routine_id, title, notes, sort_order, required, duration_seconds
       FROM routine_steps
       WHERE routine_id = ? AND deleted_at IS NULL
       ORDER BY sort_order, created_at`,
      [routineId],
    );
    return rows.map((row) => ({
      id: row.id,
      routineId: row.routine_id,
      title: row.title,
      notes: row.notes,
      sortOrder: row.sort_order,
      required: row.required === 1,
      durationSeconds: row.duration_seconds,
    }));
  }

  async listRoutineRunSteps(routineRunId: string): Promise<RoutineRunStep[]> {
    const rows = await this.database.getAllAsync<RoutineRunStepRow>(
      `SELECT rrs.routine_run_id, rrs.step_id, rs.title, rs.required,
              rs.duration_seconds, rrs.status, rrs.started_at, rrs.finished_at,
              rrs.elapsed_seconds, rrs.note
       FROM routine_run_steps rrs
       JOIN routine_steps rs ON rs.id = rrs.step_id
       WHERE rrs.routine_run_id = ?
       ORDER BY rs.sort_order, rs.created_at`,
      [routineRunId],
    );
    return rows.map((row) => ({
      routineRunId: row.routine_run_id,
      stepId: row.step_id,
      title: row.title,
      required: row.required === 1,
      durationSeconds: row.duration_seconds,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      elapsedSeconds: row.elapsed_seconds,
      note: row.note,
    }));
  }

  async listReminderRules(itemId: string): Promise<ReminderRuleRecord[]> {
    const rows = await this.database.getAllAsync<ReminderRuleRow>(
      `SELECT id, item_id, schedule_slot_id, enabled, trigger_type, local_time,
              offset_minutes, exact_alarm, allow_complete, allow_snooze,
              snooze_minutes, repeat_until_completed, repeat_interval_minutes,
              android_notification_key
       FROM reminder_rules
       WHERE item_id = ? AND deleted_at IS NULL
       ORDER BY created_at`,
      [itemId],
    );
    return rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      scheduleSlotId: row.schedule_slot_id,
      enabled: row.enabled === 1,
      triggerType: row.trigger_type,
      localTime: row.local_time,
      offsetMinutes: row.offset_minutes,
      exactAlarm: row.exact_alarm === 1,
      allowComplete: row.allow_complete === 1,
      allowSnooze: row.allow_snooze === 1,
      snoozeMinutes: row.snooze_minutes,
      repeatUntilCompleted: row.repeat_until_completed === 1,
      repeatIntervalMinutes: row.repeat_interval_minutes,
      androidNotificationKey: row.android_notification_key,
    }));
  }
}
