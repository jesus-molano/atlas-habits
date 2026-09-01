import type { SQLiteDatabase } from 'expo-sqlite';

import type { CommandGateway } from '../data/command-gateway';
import { DashboardRepository } from '../data/repositories/dashboard-repository';
import { LOCAL_WORKSPACE_ID, type DashboardSnapshot } from '../data/types';
import type { DashboardSectionId, SyncState } from '../features/atlas/types';

import { localDateFromDate, recentLocalDates } from './date-time';
import {
  mapDashboardToAtlasDayView,
  mapDashboardToAtlasSnapshot,
} from './projection';

type CountRow = { count: number };
type TagRow = { id: string; name: string };
type LayoutRow = { section_key: string };
type SubtaskStateRow = {
  task_id: string;
  subtask_id: string;
  completed: number;
};
type PauseRow = { item_id: string; end_date: string | null };

const DASHBOARD_SECTIONS = new Set<DashboardSectionId>([
  'routines',
  'habits',
  'tasks',
]);

function recordFromEntries<T>(
  entries: readonly (readonly [string, T])[],
): Record<string, T> {
  return Object.fromEntries(entries);
}

function sectionFromKey(value: string): DashboardSectionId | null {
  const candidate = value.includes(':')
    ? value.slice(value.indexOf(':') + 1)
    : value;
  return DASHBOARD_SECTIONS.has(candidate as DashboardSectionId)
    ? (candidate as DashboardSectionId)
    : null;
}

async function loadDashboardOrder(
  database: SQLiteDatabase,
): Promise<DashboardSectionId[]> {
  const rows = await database.getAllAsync<LayoutRow>(
    `SELECT section_key
     FROM dashboard_layout
     WHERE workspace_id = ? AND hidden = 0
     GROUP BY section_key
     ORDER BY section_key`,
    [LOCAL_WORKSPACE_ID],
  );
  return rows
    .map((row) => sectionFromKey(row.section_key))
    .filter((section): section is DashboardSectionId => section !== null);
}

async function loadTaskSubtaskStates(
  database: SQLiteDatabase,
  localDate: string,
): Promise<Record<string, Record<string, boolean>>> {
  const rows = await database.getAllAsync<SubtaskStateRow>(
    `SELECT ti.task_id, tis.subtask_id, tis.completed
     FROM task_instance_subtasks tis
     JOIN task_instances ti ON ti.id = tis.task_instance_id
     WHERE ti.local_date = ?`,
    [localDate],
  );
  const result: Record<string, Record<string, boolean>> = {};
  for (const row of rows) {
    result[row.task_id] ??= {};
    result[row.task_id][row.subtask_id] = row.completed === 1;
  }
  return result;
}

async function loadActivePauses(
  database: SQLiteDatabase,
  localDate: string,
): Promise<Record<string, { endDate: string | null }>> {
  const rows = await database.getAllAsync<PauseRow>(
    `SELECT item_id, end_date
     FROM item_pauses
     WHERE start_date <= ? AND (end_date IS NULL OR end_date >= ?)
     ORDER BY start_date DESC`,
    [localDate, localDate],
  );
  const result: Record<string, { endDate: string | null }> = {};
  for (const row of rows) result[row.item_id] ??= { endDate: row.end_date };
  return result;
}

async function loadProjectionRelations(
  database: SQLiteDatabase,
  gateway: CommandGateway,
  day: DashboardSnapshot,
  localDate: string,
  syncState: SyncState,
) {
  const taskIds = day.items
    .filter((item) => item.type === 'task')
    .map((item) => item.id);
  const routineIds = day.items
    .filter((item) => item.type === 'routine')
    .map((item) => item.id);
  const itemIds = day.items.map((item) => item.id);

  const [
    tagRows,
    dashboardOrder,
    taskSubtaskStatesByTaskId,
    activePausesByItemId,
    taskSubtaskEntries,
    routineStepEntries,
    reminderEntries,
    routineRunStepEntries,
  ] = await Promise.all([
    database.getAllAsync<TagRow>(
      `SELECT id, name FROM tags
       WHERE workspace_id = ? AND deleted_at IS NULL`,
      [LOCAL_WORKSPACE_ID],
    ),
    loadDashboardOrder(database),
    loadTaskSubtaskStates(database, localDate),
    loadActivePauses(database, localDate),
    Promise.all(
      taskIds.map(
        async (taskId) =>
          [taskId, await gateway.queries.listTaskSubtasks(taskId)] as const,
      ),
    ),
    Promise.all(
      routineIds.map(
        async (routineId) =>
          [
            routineId,
            await gateway.queries.listRoutineSteps(routineId),
          ] as const,
      ),
    ),
    Promise.all(
      itemIds.map(
        async (itemId) =>
          [itemId, await gateway.queries.listReminderRules(itemId)] as const,
      ),
    ),
    Promise.all(
      day.routineRuns.map(
        async (run) =>
          [run.id, await gateway.queries.listRoutineRunSteps(run.id)] as const,
      ),
    ),
  ]);

  return {
    activePausesByItemId,
    dashboardOrder,
    remindersByItemId: recordFromEntries(reminderEntries),
    routineRunStepsByRunId: recordFromEntries(routineRunStepEntries),
    routineStepsByRoutineId: recordFromEntries(routineStepEntries),
    sync: syncState,
    tagNamesById: Object.fromEntries(tagRows.map((tag) => [tag.id, tag.name])),
    taskSubtaskStatesByTaskId,
    taskSubtasksByTaskId: recordFromEntries(taskSubtaskEntries),
  };
}

export type LoadAtlasSnapshotOptions = Readonly<{
  database: SQLiteDatabase;
  gateway: CommandGateway;
  historyLength?: number;
  now?: Date;
  syncState?: SyncState;
}>;

export async function loadAtlasSnapshotFromSQLite({
  database,
  gateway,
  historyLength = 35,
  now = new Date(),
  syncState = { status: 'local-only' },
}: LoadAtlasSnapshotOptions) {
  const count = await database.getFirstAsync<CountRow>(
    `SELECT COUNT(*) AS count FROM items
     WHERE workspace_id = ? AND archived_at IS NULL AND deleted_at IS NULL`,
    [LOCAL_WORKSPACE_ID],
  );
  if ((count?.count ?? 0) === 0) return null;

  const today = localDateFromDate(now);
  const dashboard = new DashboardRepository(database);
  const dates = recentLocalDates(today, historyLength);
  const historyDays = await Promise.all(
    dates.map((date) => dashboard.loadDay(date)),
  );
  const day =
    historyDays.find((entry) => entry.localDate === today) ??
    (await dashboard.loadDay(today));
  const [relations, activeTimer, legacyTimerItemIds] = await Promise.all([
    loadProjectionRelations(database, gateway, day, today, syncState),
    gateway.progress.getActiveTimer(),
    gateway.progress.listLegacyTimerItemIds(),
  ]);

  const snapshot = mapDashboardToAtlasSnapshot({
    day,
    historyDays,
    now,
    relations,
  });
  return {
    ...snapshot,
    activeTimer: activeTimer
      ? {
          itemId: activeTimer.itemId,
          itemType: activeTimer.itemType,
          title: activeTimer.title,
          startedAt: activeTimer.startedAt,
          runningSince: activeTimer.runningSince ?? undefined,
          elapsedSeconds: activeTimer.elapsedSeconds,
        }
      : undefined,
    legacyTimerItemIds,
  };
}

export type LoadAtlasDayViewOptions = Readonly<{
  database: SQLiteDatabase;
  gateway: CommandGateway;
  localDate: string;
  now?: Date;
  syncState?: SyncState;
}>;

export async function loadAtlasDayViewFromSQLite({
  database,
  gateway,
  localDate,
  now = new Date(`${localDate}T23:59:59.999`),
  syncState = { status: 'local-only' },
}: LoadAtlasDayViewOptions) {
  const day = await new DashboardRepository(database).loadDay(localDate);
  const relations = await loadProjectionRelations(
    database,
    gateway,
    day,
    localDate,
    syncState,
  );
  return mapDashboardToAtlasDayView({
    day,
    historyDays: [day],
    now,
    relations,
  });
}
