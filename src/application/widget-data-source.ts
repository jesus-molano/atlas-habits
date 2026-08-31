import type { SQLiteDatabase } from 'expo-sqlite';

import { getCommandGateway, getDatabase } from '../data';
import {
  addDays,
  daysBetween,
  endOfMonth,
  endOfWeek,
  isLocalDate,
  isoWeekday,
  startOfMonth,
  startOfWeek,
  type LocalDate,
} from '../domain';
import type { HabitItem } from '../features/atlas/types';
import type {
  AtlasWidgetDataSource,
  AtlasWidgetName,
  AtlasWidgetSnapshot,
  WidgetUpcomingTask,
} from '../widgets';

import { localDateFromDate } from './date-time';
import { loadAtlasSnapshotFromSQLite } from './snapshot-loader';

export type WidgetScheduleRuleType =
  'once' | 'daily' | 'weekdays' | 'interval' | 'period_quota';

export type WidgetScheduleDefinition = Readonly<{
  itemId: string;
  itemType: 'habit' | 'task' | 'routine';
  title: string;
  priority: number;
  dueAt: number | null;
  isPaused: boolean;
  scheduleVersionId: string;
  versionNumber: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  ruleType: WidgetScheduleRuleType;
  rule: Readonly<Record<string, unknown>>;
  measurementType: 'boolean' | 'quantity' | 'duration' | null;
  goalTarget: number;
}>;

type ScheduleDefinitionRow = Readonly<{
  item_id: string;
  item_type: WidgetScheduleDefinition['itemType'];
  title: string;
  priority: number | null;
  due_at: number | null;
  is_paused: number;
  schedule_version_id: string;
  version_number: number;
  effective_from: string;
  effective_until: string | null;
  rule_type: WidgetScheduleRuleType;
  rule_json: string;
  measurement_type: 'boolean' | 'quantity' | 'duration' | null;
  goal_target: number | null;
}>;

type TaskInstanceRow = Readonly<{
  task_id: string;
  local_date: string;
  status: 'pending' | 'completed' | 'skipped' | 'cancelled';
}>;

type QuotaMeasurementRow = Readonly<{
  id: string;
  item_id: string;
  occurrence_key: string | null;
  session_id: string | null;
  local_date: string;
  value: number;
  operation: 'add' | 'set';
  occurred_at: number;
}>;

type QuotaOverrideRow = Readonly<{
  item_id: string;
  occurrence_key: string;
  local_date: string;
  state: 'complete' | 'excused' | 'reset' | 'force_due' | 'force_not_due';
}>;

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

function finiteInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.round(value))
    : fallback;
}

function definitionDate(value: unknown, fallback: LocalDate): LocalDate {
  return typeof value === 'string' && isLocalDate(value) ? value : fallback;
}

function localDateFromTimestamp(timestamp: number | null): LocalDate | null {
  if (timestamp === null || !Number.isFinite(timestamp)) return null;
  return localDateFromDate(new Date(timestamp));
}

function onceDate(definition: WidgetScheduleDefinition): LocalDate {
  const effectiveFrom = definitionDate(definition.effectiveFrom, '1970-01-01');
  const ruleDate = definitionDate(definition.rule.date, effectiveFrom);
  const dueDate =
    definition.itemType === 'task'
      ? localDateFromTimestamp(definition.dueAt)
      : null;
  return dueDate && dueDate > ruleDate ? dueDate : ruleDate;
}

/** Pure schedule check shared by widget progress and upcoming-task selection. */
export function isWidgetScheduleDueOnDate(
  definition: WidgetScheduleDefinition,
  date: LocalDate,
): boolean {
  const effectiveFrom = definitionDate(definition.effectiveFrom, date);
  if (
    date < effectiveFrom ||
    (definition.effectiveUntil !== null &&
      isLocalDate(definition.effectiveUntil) &&
      date > definition.effectiveUntil)
  ) {
    return false;
  }

  const firstTaskDate =
    definition.itemType === 'task'
      ? localDateFromTimestamp(definition.dueAt)
      : null;
  if (firstTaskDate && date < firstTaskDate) return false;

  switch (definition.ruleType) {
    case 'once':
      return date === onceDate(definition);
    case 'daily':
    case 'period_quota':
      return true;
    case 'weekdays': {
      const days = Array.isArray(definition.rule.days)
        ? definition.rule.days.filter(
            (entry): entry is number =>
              typeof entry === 'number' &&
              Number.isInteger(entry) &&
              entry >= 1 &&
              entry <= 7,
          )
        : [];
      return days.includes(isoWeekday(date));
    }
    case 'interval': {
      const anchor = definitionDate(definition.rule.anchorDate, effectiveFrom);
      const distance = daysBetween(anchor, date);
      return (
        distance >= 0 &&
        distance % finiteInteger(definition.rule.every, 1) === 0
      );
    }
  }
}

function activeDefinition(
  definitions: readonly WidgetScheduleDefinition[],
  date: LocalDate,
): WidgetScheduleDefinition | null {
  return (
    definitions
      .filter((definition) => isWidgetScheduleDueOnDate(definition, date))
      .sort((left, right) => right.versionNumber - left.versionNumber)[0] ??
    null
  );
}

export function widgetHabitOccurrenceId(
  habitId: string,
  localDate: LocalDate,
  quotaRevision?: number,
): string {
  const item = encodeURIComponent(habitId);
  return quotaRevision === undefined
    ? `atlas:v1:habit:${item}:${localDate}`
    : `atlas:v1:habit:${item}:quota:widget:${quotaRevision}:${localDate}`;
}

function quotaBounds(
  definition: WidgetScheduleDefinition,
  today: LocalDate,
): { from: LocalDate; to: LocalDate } {
  if (definition.rule.period === 'month') {
    return { from: startOfMonth(today), to: endOfMonth(today) };
  }
  const rawWeekStart = finiteInteger(definition.rule.weekStartsOn, 1);
  const weekStartsOn = Math.min(7, rawWeekStart) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
  return {
    from: startOfWeek(today, weekStartsOn),
    to: endOfWeek(today, weekStartsOn),
  };
}

function quotaProgress(
  definition: WidgetScheduleDefinition,
  today: LocalDate,
  measurements: readonly QuotaMeasurementRow[],
  overrides: readonly QuotaOverrideRow[],
): number {
  const bounds = quotaBounds(definition, today);
  const completedKeys = new Set<string>();
  const aggregates = new Map<string, number>();
  for (const measurement of measurements
    .filter(
      (entry) =>
        entry.item_id === definition.itemId &&
        entry.local_date >= bounds.from &&
        entry.local_date <= bounds.to,
    )
    .sort(
      (left, right) =>
        left.occurred_at - right.occurred_at || left.id.localeCompare(right.id),
    )) {
    const key =
      measurement.occurrence_key ??
      (measurement.session_id
        ? `session:${measurement.session_id}`
        : `day:${measurement.local_date}`);
    const before = aggregates.get(key) ?? 0;
    aggregates.set(
      key,
      measurement.operation === 'set'
        ? measurement.value
        : before + measurement.value,
    );
  }
  for (const [key, value] of aggregates) {
    if (
      definition.measurementType === 'boolean'
        ? value > 0
        : value >= definition.goalTarget
    ) {
      completedKeys.add(key);
    }
  }
  for (const override of overrides) {
    if (
      override.item_id !== definition.itemId ||
      override.local_date < bounds.from ||
      override.local_date > bounds.to
    ) {
      continue;
    }
    if (override.state === 'complete')
      completedKeys.add(override.occurrence_key);
    if (override.state === 'reset')
      completedKeys.delete(override.occurrence_key);
  }
  return completedKeys.size;
}

function taskKey(taskId: string, localDate: string): string {
  return `${taskId}:${localDate}`;
}

function nextScheduledTaskDate(
  definitions: readonly WidgetScheduleDefinition[],
  completed: ReadonlySet<string>,
  today: LocalDate,
  horizonDays = 366,
): LocalDate | null {
  const onceDefinitions = definitions.filter(
    (definition) => definition.ruleType === 'once',
  );
  const overdue = onceDefinitions
    .map(onceDate)
    .filter(
      (date) =>
        date < today && !completed.has(taskKey(definitions[0]!.itemId, date)),
    )
    .sort()[0];
  if (overdue) return overdue;

  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const date = addDays(today, offset);
    const definition = activeDefinition(definitions, date);
    if (definition && !completed.has(taskKey(definition.itemId, date))) {
      return date;
    }
  }
  return null;
}

function timeLabel(timestamp: number | null): string | null {
  if (timestamp === null || !Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

function dueLabel(
  date: LocalDate,
  today: LocalDate,
  dueAt: number | null,
): string {
  const time = timeLabel(dueAt);
  const suffix = time ? ` · ${time}` : '';
  const distance = daysBetween(today, date);
  if (distance < 0) return `Atrasada${suffix}`;
  if (distance === 0) return `Hoy${suffix}`;
  if (distance === 1) return `Mañana${suffix}`;
  return `${date.slice(8, 10)}/${date.slice(5, 7)}${suffix}`;
}

function priority(value: number): WidgetUpcomingTask['priority'] {
  if (value >= 3) return 'high';
  if (value >= 2) return 'medium';
  return 'low';
}

async function loadScheduleDefinitions(
  database: SQLiteDatabase,
  today: LocalDate,
): Promise<WidgetScheduleDefinition[]> {
  const rows = await database.getAllAsync<ScheduleDefinitionRow>(
    `SELECT
       i.id AS item_id,
       i.type AS item_type,
       i.title,
       t.priority,
       t.due_at,
       EXISTS(
         SELECT 1 FROM item_pauses p
          WHERE p.item_id = i.id
            AND p.start_date <= ?
            AND (p.end_date IS NULL OR p.end_date >= ?)
       ) AS is_paused,
       sv.id AS schedule_version_id,
       sv.version_number,
       sv.effective_from,
       sv.effective_until,
       sv.rule_type,
       sv.rule_json,
       h.measurement_type,
       COALESCE(
         (SELECT sg.target_value
            FROM schedule_goals sg
           WHERE sg.schedule_version_id = sv.id
           ORDER BY sg.id LIMIT 1),
         1
       ) AS goal_target
     FROM items i
     JOIN schedules s ON s.item_id = i.id AND s.retired_at IS NULL
     JOIN schedule_versions sv ON sv.schedule_id = s.id
     LEFT JOIN habits h ON h.item_id = i.id
     LEFT JOIN tasks t ON t.item_id = i.id
     WHERE i.archived_at IS NULL AND i.deleted_at IS NULL
     ORDER BY i.id, sv.version_number`,
    [today, today],
  );
  return rows.map((row) => ({
    itemId: row.item_id,
    itemType: row.item_type,
    title: row.title,
    priority: row.priority ?? 0,
    dueAt: row.due_at,
    isPaused: row.is_paused === 1,
    scheduleVersionId: row.schedule_version_id,
    versionNumber: row.version_number,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    ruleType: row.rule_type,
    rule: parseRule(row.rule_json),
    measurementType: row.measurement_type,
    goalTarget: Math.max(1, row.goal_target ?? 1),
  }));
}

function groupDefinitions(
  definitions: readonly WidgetScheduleDefinition[],
): Map<string, WidgetScheduleDefinition[]> {
  const result = new Map<string, WidgetScheduleDefinition[]>();
  for (const definition of definitions) {
    const values = result.get(definition.itemId) ?? [];
    values.push(definition);
    result.set(definition.itemId, values);
  }
  return result;
}

function habitCompleted(habit: HabitItem): boolean {
  return habit.metric === 'boolean'
    ? habit.completed
    : habit.value >= habit.target;
}

export class SQLiteAtlasWidgetDataSource implements AtlasWidgetDataSource {
  constructor(
    private readonly databaseProvider: () => Promise<SQLiteDatabase> = getDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getSnapshot(
    _widgetName: AtlasWidgetName,
  ): Promise<AtlasWidgetSnapshot> {
    const now = this.now();
    const today = localDateFromDate(now);
    const database = await this.databaseProvider();
    const gateway = await getCommandGateway();
    const [snapshot, definitions, taskRows, measurements, overrides] =
      await Promise.all([
        loadAtlasSnapshotFromSQLite({ database, gateway, now }),
        loadScheduleDefinitions(database, today),
        database.getAllAsync<TaskInstanceRow>(
          `SELECT task_id, local_date, status FROM task_instances`,
        ),
        database.getAllAsync<QuotaMeasurementRow>(
          `SELECT id, item_id, occurrence_key, session_id, local_date, value,
                  operation, occurred_at
             FROM measurements
            WHERE deleted_at IS NULL`,
        ),
        database.getAllAsync<QuotaOverrideRow>(
          `SELECT item_id, occurrence_key, local_date, state
             FROM occurrence_overrides`,
        ),
      ]);

    if (!snapshot) return emptyWidgetSnapshot(now);
    const byItem = groupDefinitions(definitions);
    const completedTasks = new Set(
      taskRows
        .filter((row) => row.status === 'completed')
        .map((row) => taskKey(row.task_id, row.local_date)),
    );

    const habits = snapshot.habits.flatMap((habit) => {
      const candidates = byItem.get(habit.id) ?? [];
      const definition = activeDefinition(candidates, today);
      if (!definition || definition.isPaused || habit.skipped) return [];
      if (definition.ruleType === 'period_quota') {
        const progress = quotaProgress(
          definition,
          today,
          measurements,
          overrides,
        );
        const quota = finiteInteger(definition.rule.quota, 1);
        return [
          {
            targetKind: 'habit' as const,
            targetId: habit.id,
            occurrenceId: widgetHabitOccurrenceId(habit.id, today, progress),
            title: `${habit.title} · ${Math.min(progress, quota)}/${quota}`,
            completed: progress >= quota,
          },
        ];
      }
      return [
        {
          targetKind: 'habit' as const,
          targetId: habit.id,
          occurrenceId: widgetHabitOccurrenceId(habit.id, today),
          title: habit.title,
          completed: habitCompleted(habit),
        },
      ];
    });

    const scheduledTaskIds = new Set(
      snapshot.tasks
        .filter((task) => {
          const definition = activeDefinition(byItem.get(task.id) ?? [], today);
          return definition !== null && !definition.isPaused;
        })
        .map((task) => task.id),
    );
    const scheduledRoutineIds = new Set(
      snapshot.routines
        .filter((routine) => {
          const definition = activeDefinition(
            byItem.get(routine.id) ?? [],
            today,
          );
          return definition !== null && !definition.isPaused;
        })
        .map((routine) => routine.id),
    );
    const activeHabits = habits;
    const completed =
      activeHabits.filter((habit) => habit.completed).length +
      snapshot.tasks.filter(
        (task) => scheduledTaskIds.has(task.id) && task.completed,
      ).length +
      snapshot.routines.filter(
        (routine) => scheduledRoutineIds.has(routine.id) && routine.completed,
      ).length;
    const total =
      activeHabits.length + scheduledTaskIds.size + scheduledRoutineIds.size;

    const upcomingTasks = [...byItem.values()]
      .filter((entries) => entries[0]?.itemType === 'task')
      .flatMap((entries) => {
        const nextDate = nextScheduledTaskDate(entries, completedTasks, today);
        if (!nextDate) return [];
        const definition =
          activeDefinition(entries, nextDate) ??
          entries
            .filter((entry) => entry.ruleType === 'once')
            .sort((left, right) => right.versionNumber - left.versionNumber)[0];
        if (!definition || definition.isPaused) return [];
        return [
          {
            id: `${definition.itemId}:${nextDate}`,
            title: definition.title,
            dueLabel: dueLabel(nextDate, today, definition.dueAt),
            priority: priority(definition.priority),
            sortDate: nextDate,
          },
        ];
      })
      .sort(
        (left, right) =>
          left.sortDate.localeCompare(right.sortDate) ||
          left.title.localeCompare(right.title, 'es'),
      )
      .map(({ sortDate: _sortDate, ...task }) => task)
      .slice(0, 3);

    return {
      generatedAt: now.toISOString(),
      progress: {
        completed,
        total,
        streakDays: Math.max(
          0,
          ...snapshot.habits
            .filter((habit) =>
              activeHabits.some((entry) => entry.targetId === habit.id),
            )
            .map((habit) => habit.streak),
        ),
      },
      habits,
      upcomingTasks,
    };
  }
}

function emptyWidgetSnapshot(now: Date): AtlasWidgetSnapshot {
  return {
    generatedAt: now.toISOString(),
    progress: { completed: 0, total: 0, streakDays: 0 },
    habits: [],
    upcomingTasks: [],
  };
}

export const atlasWidgetDataSource = new SQLiteAtlasWidgetDataSource();
