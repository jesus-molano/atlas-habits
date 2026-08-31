import { stableStringify } from '../data/canonical-json';
import type { SqlExecutor } from '../data/transaction';
import { LOCAL_WORKSPACE_ID } from '../data/types';

import type { EntityField } from './coordinator/types';
import { parseAndValidateHlc } from './coordinator/version';
import { SyncIntegrityError } from './errors';
import type { JsonValue, SyncMutationEnvelope } from './types';

type SqlValue = string | number | null;
type JsonObject = Readonly<Record<string, JsonValue>>;
type AcceptedFields = ReadonlyMap<string, JsonValue>;

function fieldsMap(fields: readonly EntityField[]): AcceptedFields {
  return new Map(fields.map((field) => [field.name, field.value]));
}

function objectValue(value: JsonValue | undefined, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SyncIntegrityError(`${label} must be an object.`);
  }
  return value as JsonObject;
}

function arrayValue(
  value: JsonValue | undefined,
  label: string,
): readonly JsonValue[] {
  if (!Array.isArray(value))
    throw new SyncIntegrityError(`${label} must be an array.`);
  return value;
}

function requiredString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SyncIntegrityError(`${label} must be a non-empty string.`);
  }
  return value;
}

function stringOr(value: JsonValue | undefined, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(
  value: JsonValue | undefined,
  label: string,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string')
    throw new SyncIntegrityError(`${label} must be a string or null.`);
  return value;
}

function requiredNumber(value: JsonValue | undefined, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SyncIntegrityError(`${label} must be a finite number.`);
  }
  return value;
}

function nullableNumber(
  value: JsonValue | undefined,
  label: string,
): number | null {
  if (value === null || value === undefined) return null;
  return requiredNumber(value, label);
}

function integerFlag(value: JsonValue | undefined, fallback: boolean): number {
  if (value === undefined) return fallback ? 1 : 0;
  if (typeof value !== 'boolean')
    throw new SyncIntegrityError('A boolean field is invalid.');
  return value ? 1 : 0;
}

function mutationTime(mutation: SyncMutationEnvelope): number {
  return parseAndValidateHlc(mutation.hlc).wallTime;
}

async function ensureWorkspace(
  executor: SqlExecutor,
  workspaceId: string,
  timestamp: number,
): Promise<void> {
  await executor.runAsync(
    `INSERT OR IGNORE INTO workspaces (id, name, created_at, updated_at)
     VALUES (?, 'Personal', ?, ?)`,
    [workspaceId, timestamp, timestamp],
  );
}

type ColumnMapping = Readonly<{
  column: string;
  convert: (value: JsonValue) => SqlValue;
}>;

async function updateMappedFields(
  executor: SqlExecutor,
  table: string,
  keyColumn: string,
  keyValue: string,
  fields: AcceptedFields,
  mappings: Readonly<Record<string, ColumnMapping>>,
  extraAssignments: readonly string[] = [],
  extraValues: readonly SqlValue[] = [],
): Promise<void> {
  const assignments: string[] = [];
  const values: SqlValue[] = [];
  for (const [fieldName, mapping] of Object.entries(mappings)) {
    if (!fields.has(fieldName)) continue;
    assignments.push(`${mapping.column} = ?`);
    values.push(mapping.convert(fields.get(fieldName) as JsonValue));
  }
  assignments.push(...extraAssignments);
  values.push(...extraValues);
  if (assignments.length === 0) return;
  await executor.runAsync(
    `UPDATE ${table} SET ${assignments.join(', ')} WHERE ${keyColumn} = ?`,
    [...values, keyValue],
  );
}

const stringColumn = (column: string): ColumnMapping => ({
  column,
  convert: (value) => requiredString(value, column),
});

const nullableStringColumn = (column: string): ColumnMapping => ({
  column,
  convert: (value) => nullableString(value, column),
});

const numberColumn = (column: string): ColumnMapping => ({
  column,
  convert: (value) => requiredNumber(value, column),
});

const nullableNumberColumn = (column: string): ColumnMapping => ({
  column,
  convert: (value) => nullableNumber(value, column),
});

const booleanColumn = (column: string): ColumnMapping => ({
  column,
  convert: (value) => integerFlag(value, false),
});

async function upsertNamedMetadata(
  executor: SqlExecutor,
  mutation: SyncMutationEnvelope,
  fields: AcceptedFields,
  table: 'categories' | 'tags',
): Promise<void> {
  const timestamp = mutationTime(mutation);
  const existing = await executor.getFirstAsync<{ id: string }>(
    `SELECT id FROM ${table} WHERE id = ?`,
    [mutation.entityId],
  );
  const workspaceId =
    typeof fields.get('workspaceId') === 'string'
      ? (fields.get('workspaceId') as string)
      : LOCAL_WORKSPACE_ID;
  await ensureWorkspace(executor, workspaceId, timestamp);

  if (!existing) {
    const name = requiredString(fields.get('name'), `${table}.name`).trim();
    if (table === 'categories') {
      await executor.runAsync(
        `INSERT INTO categories
          (id, workspace_id, name, color, icon, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mutation.entityId,
          workspaceId,
          name,
          nullableString(fields.get('color'), 'category.color'),
          nullableString(fields.get('icon'), 'category.icon'),
          fields.has('sortOrder')
            ? requiredNumber(fields.get('sortOrder'), 'category.sortOrder')
            : 0,
          fields.has('createdAt')
            ? requiredNumber(fields.get('createdAt'), 'category.createdAt')
            : timestamp,
          fields.has('updatedAt')
            ? requiredNumber(fields.get('updatedAt'), 'category.updatedAt')
            : timestamp,
        ],
      );
    } else {
      await executor.runAsync(
        `INSERT INTO tags
          (id, workspace_id, name, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          mutation.entityId,
          workspaceId,
          name,
          nullableString(fields.get('color'), 'tag.color'),
          fields.has('createdAt')
            ? requiredNumber(fields.get('createdAt'), 'tag.createdAt')
            : timestamp,
          fields.has('updatedAt')
            ? requiredNumber(fields.get('updatedAt'), 'tag.updatedAt')
            : timestamp,
        ],
      );
    }
    return;
  }

  await updateMappedFields(
    executor,
    table,
    'id',
    mutation.entityId,
    fields,
    table === 'categories'
      ? {
          workspaceId: stringColumn('workspace_id'),
          name: stringColumn('name'),
          color: nullableStringColumn('color'),
          icon: nullableStringColumn('icon'),
          sortOrder: numberColumn('sort_order'),
          updatedAt: numberColumn('updated_at'),
        }
      : {
          workspaceId: stringColumn('workspace_id'),
          name: stringColumn('name'),
          color: nullableStringColumn('color'),
          updatedAt: numberColumn('updated_at'),
        },
    ['deleted_at = NULL'],
  );
}

async function upsertScheduleGraph(
  executor: SqlExecutor,
  itemId: string,
  scheduleValue: JsonValue,
  timestamp: number,
): Promise<void> {
  const schedule = objectValue(scheduleValue, 'item.schedule');
  const scheduleId = requiredString(schedule.id, 'schedule.id');
  const versionId = requiredString(schedule.versionId, 'schedule.versionId');
  const timezone = requiredString(schedule.timezone, 'schedule.timezone');
  await executor.runAsync(
    `INSERT INTO schedules (id, item_id, timezone, created_at, retired_at)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       item_id = excluded.item_id,
       timezone = excluded.timezone,
       retired_at = NULL`,
    [scheduleId, itemId, timezone, timestamp],
  );
  await upsertScheduleVersion(
    executor,
    scheduleId,
    versionId,
    typeof schedule.versionNumber === 'number' ? schedule.versionNumber : 1,
    schedule,
    schedule.slots,
    schedule.goals,
    timestamp,
  );
}

async function upsertScheduleVersion(
  executor: SqlExecutor,
  scheduleId: string,
  versionId: string,
  versionNumber: number,
  version: JsonObject,
  slotsValue: JsonValue | undefined,
  goalsValue: JsonValue | undefined,
  timestamp: number,
): Promise<void> {
  const effectiveFrom = requiredString(
    version.effectiveFrom,
    'schedule.effectiveFrom',
  );
  const existingAtNumber = await executor.getFirstAsync<{ id: string }>(
    `SELECT id FROM schedule_versions
     WHERE schedule_id = ? AND version_number = ?`,
    [scheduleId, versionNumber],
  );
  if (existingAtNumber && existingAtNumber.id !== versionId) {
    await executor.runAsync('DELETE FROM schedule_versions WHERE id = ?', [
      existingAtNumber.id,
    ]);
  }
  await executor.runAsync(
    `INSERT INTO schedule_versions
      (id, schedule_id, version_number, effective_from, effective_until,
       rule_type, rule_json, grace_minutes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       schedule_id = excluded.schedule_id,
       version_number = excluded.version_number,
       effective_from = excluded.effective_from,
       effective_until = excluded.effective_until,
       rule_type = excluded.rule_type,
       rule_json = excluded.rule_json,
       grace_minutes = excluded.grace_minutes`,
    [
      versionId,
      scheduleId,
      versionNumber,
      effectiveFrom,
      nullableString(version.effectiveUntil, 'schedule.effectiveUntil'),
      requiredString(version.ruleType, 'schedule.ruleType'),
      stableStringify(version.rule ?? {}),
      typeof version.graceMinutes === 'number' ? version.graceMinutes : 0,
      timestamp,
    ],
  );

  if (slotsValue !== undefined) {
    for (const entry of arrayValue(slotsValue, 'schedule.slots')) {
      const slot = objectValue(entry, 'schedule slot');
      const slotId = requiredString(slot.id, 'schedule slot id');
      await executor.runAsync(
        `INSERT INTO schedule_slots
          (id, schedule_version_id, slot_key, label, local_time, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           schedule_version_id = excluded.schedule_version_id,
           slot_key = excluded.slot_key,
           label = excluded.label,
           local_time = excluded.local_time,
           sort_order = excluded.sort_order`,
        [
          slotId,
          versionId,
          requiredString(slot.key, 'schedule slot key'),
          nullableString(slot.label, 'schedule slot label'),
          nullableString(slot.localTime, 'schedule slot localTime'),
          typeof slot.sortOrder === 'number' ? slot.sortOrder : 0,
        ],
      );
    }
  }

  if (goalsValue !== undefined) {
    for (const entry of arrayValue(goalsValue, 'schedule.goals')) {
      const goal = objectValue(entry, 'schedule goal');
      await executor.runAsync(
        `INSERT INTO schedule_goals
          (id, schedule_version_id, slot_id, measurement_type, aggregation,
           comparison, target_value, unit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           schedule_version_id = excluded.schedule_version_id,
           slot_id = excluded.slot_id,
           measurement_type = excluded.measurement_type,
           aggregation = excluded.aggregation,
           comparison = excluded.comparison,
           target_value = excluded.target_value,
           unit = excluded.unit`,
        [
          requiredString(goal.id, 'schedule goal id'),
          versionId,
          nullableString(goal.slotId, 'schedule goal slotId'),
          requiredString(goal.measurementType, 'schedule goal measurementType'),
          typeof goal.aggregation === 'string'
            ? goal.aggregation
            : goal.measurementType === 'boolean'
              ? 'count'
              : 'sum',
          typeof goal.comparison === 'string' ? goal.comparison : 'at_least',
          requiredNumber(goal.targetValue, 'schedule goal targetValue'),
          nullableString(goal.unit, 'schedule goal unit'),
        ],
      );
    }
  }
}

async function replaceItemTags(
  executor: SqlExecutor,
  itemId: string,
  value: JsonValue,
  timestamp: number,
): Promise<void> {
  const tagIds = arrayValue(value, 'item.tagIds').map((entry) =>
    requiredString(entry, 'item tag id'),
  );
  await executor.runAsync('DELETE FROM item_tags WHERE item_id = ?', [itemId]);
  for (const tagId of new Set(tagIds)) {
    await executor.runAsync(
      `INSERT INTO item_tags (item_id, tag_id, created_at)
       VALUES (?, ?, ?)`,
      [itemId, tagId, timestamp],
    );
  }
}

async function replaceTaskSubtasks(
  executor: SqlExecutor,
  taskId: string,
  value: JsonValue,
  timestamp: number,
): Promise<void> {
  const seen: string[] = [];
  for (const entry of arrayValue(value, 'task.subtasks')) {
    const subtask = objectValue(entry, 'task subtask');
    const id = requiredString(subtask.id, 'task subtask id');
    seen.push(id);
    await executor.runAsync(
      `INSERT INTO task_subtasks
        (id, task_id, title, sort_order, required, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         task_id = excluded.task_id,
         title = excluded.title,
         sort_order = excluded.sort_order,
         required = excluded.required,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
      [
        id,
        taskId,
        requiredString(subtask.title, 'task subtask title').trim(),
        typeof subtask.sortOrder === 'number' ? subtask.sortOrder : 0,
        integerFlag(subtask.required, true),
        timestamp,
        timestamp,
      ],
    );
  }
  if (seen.length === 0) {
    await executor.runAsync(
      'UPDATE task_subtasks SET deleted_at = ?, updated_at = ? WHERE task_id = ?',
      [timestamp, timestamp, taskId],
    );
  } else {
    const placeholders = seen.map(() => '?').join(', ');
    await executor.runAsync(
      `UPDATE task_subtasks SET deleted_at = ?, updated_at = ?
       WHERE task_id = ? AND id NOT IN (${placeholders})`,
      [timestamp, timestamp, taskId, ...seen],
    );
  }
}

async function replaceRoutineSteps(
  executor: SqlExecutor,
  routineId: string,
  value: JsonValue,
  timestamp: number,
): Promise<void> {
  const seen: string[] = [];
  for (const entry of arrayValue(value, 'routine.steps')) {
    const step = objectValue(entry, 'routine step');
    const id = requiredString(step.id, 'routine step id');
    seen.push(id);
    await executor.runAsync(
      `INSERT INTO routine_steps
        (id, routine_id, title, notes, sort_order, required, duration_seconds,
         created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         routine_id = excluded.routine_id,
         title = excluded.title,
         notes = excluded.notes,
         sort_order = excluded.sort_order,
         required = excluded.required,
         duration_seconds = excluded.duration_seconds,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
      [
        id,
        routineId,
        requiredString(step.title, 'routine step title').trim(),
        nullableString(step.notes, 'routine step notes'),
        typeof step.sortOrder === 'number' ? step.sortOrder : 0,
        integerFlag(step.required, true),
        nullableNumber(step.durationSeconds, 'routine step durationSeconds'),
        timestamp,
        timestamp,
      ],
    );
  }
  if (seen.length === 0) {
    await executor.runAsync(
      'UPDATE routine_steps SET deleted_at = ?, updated_at = ? WHERE routine_id = ?',
      [timestamp, timestamp, routineId],
    );
  } else {
    const placeholders = seen.map(() => '?').join(', ');
    await executor.runAsync(
      `UPDATE routine_steps SET deleted_at = ?, updated_at = ?
       WHERE routine_id = ? AND id NOT IN (${placeholders})`,
      [timestamp, timestamp, routineId, ...seen],
    );
  }
}

async function upsertItem(
  executor: SqlExecutor,
  mutation: SyncMutationEnvelope,
  fields: AcceptedFields,
): Promise<void> {
  const timestamp = mutationTime(mutation);
  const existing = await executor.getFirstAsync<{
    type: 'habit' | 'task' | 'routine';
  }>('SELECT type FROM items WHERE id = ?', [mutation.entityId]);

  if (!existing) {
    const workspaceId =
      typeof fields.get('workspaceId') === 'string'
        ? (fields.get('workspaceId') as string)
        : LOCAL_WORKSPACE_ID;
    await ensureWorkspace(executor, workspaceId, timestamp);
    const type = requiredString(fields.get('type'), 'item.type');
    if (type !== 'habit' && type !== 'task' && type !== 'routine') {
      throw new SyncIntegrityError(`Unsupported item type ${type}.`);
    }
    const createdAt = fields.has('createdAt')
      ? requiredNumber(fields.get('createdAt'), 'item.createdAt')
      : timestamp;
    const updatedAt = fields.has('updatedAt')
      ? Math.max(
          createdAt,
          requiredNumber(fields.get('updatedAt'), 'item.updatedAt'),
        )
      : createdAt;
    await executor.runAsync(
      `INSERT INTO items
        (id, workspace_id, type, title, notes, color, icon, category_id,
         sort_order, created_at, updated_at, archived_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        mutation.entityId,
        workspaceId,
        type,
        requiredString(fields.get('title'), 'item.title').trim(),
        nullableString(fields.get('notes'), 'item.notes'),
        nullableString(fields.get('color'), 'item.color'),
        nullableString(fields.get('icon'), 'item.icon'),
        nullableString(fields.get('categoryId'), 'item.categoryId'),
        fields.has('sortOrder')
          ? requiredNumber(fields.get('sortOrder'), 'item.sortOrder')
          : timestamp,
        createdAt,
        updatedAt,
        nullableNumber(fields.get('archivedAt'), 'item.archivedAt'),
      ],
    );
    if (type === 'habit') {
      await executor.runAsync(
        `INSERT INTO habits
          (item_id, measurement_type, unit, default_value, timer_started_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          mutation.entityId,
          stringOr(fields.get('measurementType'), 'boolean'),
          nullableString(fields.get('unit'), 'habit.unit'),
          fields.has('defaultValue')
            ? requiredNumber(fields.get('defaultValue'), 'habit.defaultValue')
            : 1,
          nullableNumber(fields.get('timerStartedAt'), 'habit.timerStartedAt'),
        ],
      );
    } else if (type === 'task') {
      await executor.runAsync(
        `INSERT INTO tasks (item_id, priority, all_day, due_at, deadline_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          mutation.entityId,
          fields.has('priority')
            ? requiredNumber(fields.get('priority'), 'task.priority')
            : 0,
          integerFlag(fields.get('allDay'), true),
          nullableNumber(fields.get('dueAt'), 'task.dueAt'),
          nullableNumber(fields.get('deadlineAt'), 'task.deadlineAt'),
        ],
      );
    } else {
      await executor.runAsync(
        `INSERT INTO routines (item_id, completion_policy) VALUES (?, ?)`,
        [
          mutation.entityId,
          stringOr(fields.get('completionPolicy'), 'all_required'),
        ],
      );
    }
  } else {
    await updateMappedFields(
      executor,
      'items',
      'id',
      mutation.entityId,
      fields,
      {
        workspaceId: stringColumn('workspace_id'),
        title: stringColumn('title'),
        notes: nullableStringColumn('notes'),
        color: nullableStringColumn('color'),
        icon: nullableStringColumn('icon'),
        categoryId: nullableStringColumn('category_id'),
        sortOrder: numberColumn('sort_order'),
        updatedAt: numberColumn('updated_at'),
        archivedAt: nullableNumberColumn('archived_at'),
      },
      ['deleted_at = NULL'],
    );
  }

  const itemType =
    existing?.type ?? (fields.get('type') as 'habit' | 'task' | 'routine');
  if (itemType === 'habit') {
    await updateMappedFields(
      executor,
      'habits',
      'item_id',
      mutation.entityId,
      fields,
      {
        measurementType: stringColumn('measurement_type'),
        unit: nullableStringColumn('unit'),
        defaultValue: numberColumn('default_value'),
        timerStartedAt: nullableNumberColumn('timer_started_at'),
      },
    );
  } else if (itemType === 'task') {
    await updateMappedFields(
      executor,
      'tasks',
      'item_id',
      mutation.entityId,
      fields,
      {
        priority: numberColumn('priority'),
        allDay: booleanColumn('all_day'),
        dueAt: nullableNumberColumn('due_at'),
        deadlineAt: nullableNumberColumn('deadline_at'),
      },
    );
  } else if (itemType === 'routine') {
    await updateMappedFields(
      executor,
      'routines',
      'item_id',
      mutation.entityId,
      fields,
      { completionPolicy: stringColumn('completion_policy') },
    );
  }

  if (fields.has('tagIds')) {
    await replaceItemTags(
      executor,
      mutation.entityId,
      fields.get('tagIds') as JsonValue,
      timestamp,
    );
  }
  if (fields.has('subtasks')) {
    await replaceTaskSubtasks(
      executor,
      mutation.entityId,
      fields.get('subtasks') as JsonValue,
      timestamp,
    );
  }
  if (fields.has('steps')) {
    await replaceRoutineSteps(
      executor,
      mutation.entityId,
      fields.get('steps') as JsonValue,
      timestamp,
    );
  }
  if (fields.has('schedule') && fields.get('schedule') !== null) {
    await upsertScheduleGraph(
      executor,
      mutation.entityId,
      fields.get('schedule') as JsonValue,
      timestamp,
    );
  }
}

async function upsertHabit(
  executor: SqlExecutor,
  mutation: SyncMutationEnvelope,
  fields: AcceptedFields,
): Promise<void> {
  const habitId =
    typeof fields.get('habitId') === 'string'
      ? (fields.get('habitId') as string)
      : mutation.entityId;
  const normalized = new Map(fields);
  if (!normalized.has('timerStartedAt') && normalized.has('startedAt')) {
    normalized.set('timerStartedAt', normalized.get('startedAt') as JsonValue);
  }
  await updateMappedFields(executor, 'habits', 'item_id', habitId, normalized, {
    measurementType: stringColumn('measurement_type'),
    unit: nullableStringColumn('unit'),
    defaultValue: numberColumn('default_value'),
    timerStartedAt: nullableNumberColumn('timer_started_at'),
  });
  await executor.runAsync('UPDATE items SET updated_at = ? WHERE id = ?', [
    mutationTime(mutation),
    habitId,
  ]);
}

async function upsertDashboardLayout(
  executor: SqlExecutor,
  mutation: SyncMutationEnvelope,
  fields: AcceptedFields,
): Promise<void> {
  if (!fields.has('entries')) return;
  const timestamp = fields.has('updatedAt')
    ? requiredNumber(fields.get('updatedAt'), 'dashboard updatedAt')
    : mutationTime(mutation);
  const workspaceId =
    typeof fields.get('workspaceId') === 'string'
      ? (fields.get('workspaceId') as string)
      : mutation.entityId;
  await ensureWorkspace(executor, workspaceId, timestamp);
  for (const value of arrayValue(fields.get('entries'), 'dashboard entries')) {
    const entry = objectValue(value, 'dashboard entry');
    await executor.runAsync(
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
        requiredString(entry.itemId, 'dashboard itemId'),
        typeof entry.sectionKey === 'string' ? entry.sectionKey : 'default',
        requiredNumber(entry.sortOrder, 'dashboard sortOrder'),
        integerFlag(entry.hidden, false),
        timestamp,
      ],
    );
  }
}

async function upsertItemPause(
  executor: SqlExecutor,
  mutation: SyncMutationEnvelope,
  fields: AcceptedFields,
): Promise<void> {
  const existing = await executor.getFirstAsync<{ id: string }>(
    'SELECT id FROM item_pauses WHERE id = ?',
    [mutation.entityId],
  );
  const timestamp = mutationTime(mutation);
  if (!existing) {
    await executor.runAsync(
      `INSERT INTO item_pauses
        (id, item_id, start_date, end_date, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        mutation.entityId,
        requiredString(fields.get('itemId'), 'pause.itemId'),
        requiredString(fields.get('startDate'), 'pause.startDate'),
        nullableString(fields.get('endDate'), 'pause.endDate'),
        nullableString(fields.get('reason'), 'pause.reason'),
        fields.has('createdAt')
          ? requiredNumber(fields.get('createdAt'), 'pause.createdAt')
          : timestamp,
      ],
    );
    return;
  }
  await updateMappedFields(
    executor,
    'item_pauses',
    'id',
    mutation.entityId,
    fields,
    {
      itemId: stringColumn('item_id'),
      startDate: stringColumn('start_date'),
      endDate: nullableStringColumn('end_date'),
      reason: nullableStringColumn('reason'),
    },
  );
}

async function upsertMeasurement(
  executor: SqlExecutor,
  mutation: SyncMutationEnvelope,
  fields: AcceptedFields,
): Promise<void> {
  const timestamp = mutationTime(mutation);
  const existing = await executor.getFirstAsync<{ id: string }>(
    'SELECT id FROM measurements WHERE id = ?',
    [mutation.entityId],
  );
  if (!existing) {
    const occurredAt = requiredNumber(
      fields.get('occurredAt'),
      'measurement.occurredAt',
    );
    await executor.runAsync(
      `INSERT INTO measurements
        (id, item_id, occurrence_key, session_id, schedule_version_id, slot_id,
         value, operation, unit, occurred_at, local_date, started_at, ended_at,
         source, note, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        mutation.entityId,
        requiredString(fields.get('itemId'), 'measurement.itemId'),
        nullableString(
          fields.get('occurrenceKey'),
          'measurement.occurrenceKey',
        ),
        nullableString(fields.get('sessionId'), 'measurement.sessionId'),
        nullableString(
          fields.get('scheduleVersionId'),
          'measurement.scheduleVersionId',
        ),
        nullableString(fields.get('slotId'), 'measurement.slotId'),
        requiredNumber(fields.get('value'), 'measurement.value'),
        stringOr(fields.get('operation'), 'add'),
        nullableString(fields.get('unit'), 'measurement.unit'),
        occurredAt,
        requiredString(fields.get('localDate'), 'measurement.localDate'),
        nullableNumber(fields.get('startedAt'), 'measurement.startedAt'),
        nullableNumber(fields.get('endedAt'), 'measurement.endedAt'),
        stringOr(fields.get('source'), 'sync'),
        nullableString(fields.get('note'), 'measurement.note'),
        timestamp,
        timestamp,
      ],
    );
    return;
  }
  await updateMappedFields(
    executor,
    'measurements',
    'id',
    mutation.entityId,
    fields,
    {
      itemId: stringColumn('item_id'),
      occurrenceKey: nullableStringColumn('occurrence_key'),
      sessionId: nullableStringColumn('session_id'),
      scheduleVersionId: nullableStringColumn('schedule_version_id'),
      slotId: nullableStringColumn('slot_id'),
      value: numberColumn('value'),
      operation: stringColumn('operation'),
      unit: nullableStringColumn('unit'),
      occurredAt: numberColumn('occurred_at'),
      localDate: stringColumn('local_date'),
      startedAt: nullableNumberColumn('started_at'),
      endedAt: nullableNumberColumn('ended_at'),
      source: stringColumn('source'),
      note: nullableStringColumn('note'),
      updatedAt: numberColumn('updated_at'),
    },
    ['deleted_at = NULL'],
  );
}

async function upsertOccurrenceOverride(
  executor: SqlExecutor,
  mutation: SyncMutationEnvelope,
  fields: AcceptedFields,
): Promise<void> {
  const timestamp = mutationTime(mutation);
  const existing = await executor.getFirstAsync<{ id: string }>(
    'SELECT id FROM occurrence_overrides WHERE id = ?',
    [mutation.entityId],
  );
  if (!existing) {
    const itemId = requiredString(fields.get('itemId'), 'override.itemId');
    const occurrenceKey = requiredString(
      fields.get('occurrenceKey'),
      'override.occurrenceKey',
    );
    const logical = await executor.getFirstAsync<{ id: string }>(
      `SELECT id FROM occurrence_overrides
       WHERE item_id = ? AND occurrence_key = ?`,
      [itemId, occurrenceKey],
    );
    if (logical && logical.id !== mutation.entityId) {
      await executor.runAsync('DELETE FROM occurrence_overrides WHERE id = ?', [
        logical.id,
      ]);
    }
    await executor.runAsync(
      `INSERT INTO occurrence_overrides
        (id, item_id, occurrence_key, local_date, slot_id, state, value, note,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        mutation.entityId,
        itemId,
        occurrenceKey,
        requiredString(fields.get('localDate'), 'override.localDate'),
        nullableString(fields.get('slotId'), 'override.slotId'),
        requiredString(fields.get('state'), 'override.state'),
        nullableNumber(fields.get('value'), 'override.value'),
        nullableString(fields.get('note'), 'override.note'),
        timestamp,
        fields.has('updatedAt')
          ? requiredNumber(fields.get('updatedAt'), 'override.updatedAt')
          : timestamp,
      ],
    );
    return;
  }
  await updateMappedFields(
    executor,
    'occurrence_overrides',
    'id',
    mutation.entityId,
    fields,
    {
      itemId: stringColumn('item_id'),
      occurrenceKey: stringColumn('occurrence_key'),
      localDate: stringColumn('local_date'),
      slotId: nullableStringColumn('slot_id'),
      state: stringColumn('state'),
      value: nullableNumberColumn('value'),
      note: nullableStringColumn('note'),
      updatedAt: numberColumn('updated_at'),
    },
  );
}

async function upsertTaskInstance(
  executor: SqlExecutor,
  mutation: SyncMutationEnvelope,
  fields: AcceptedFields,
): Promise<void> {
  const timestamp = mutationTime(mutation);
  const existing = await executor.getFirstAsync<{ id: string }>(
    'SELECT id FROM task_instances WHERE id = ?',
    [mutation.entityId],
  );
  if (!existing) {
    const taskId = requiredString(fields.get('taskId'), 'task instance taskId');
    const occurrenceKey = requiredString(
      fields.get('occurrenceKey'),
      'task instance occurrenceKey',
    );
    const logical = await executor.getFirstAsync<{ id: string }>(
      'SELECT id FROM task_instances WHERE task_id = ? AND occurrence_key = ?',
      [taskId, occurrenceKey],
    );
    if (logical && logical.id !== mutation.entityId) {
      await executor.runAsync('DELETE FROM task_instances WHERE id = ?', [
        logical.id,
      ]);
    }
    const status = requiredString(fields.get('status'), 'task instance status');
    const completedAt = fields.has('completedAt')
      ? nullableNumber(fields.get('completedAt'), 'task instance completedAt')
      : status === 'completed'
        ? timestamp
        : null;
    await executor.runAsync(
      `INSERT INTO task_instances
        (id, task_id, schedule_version_id, slot_id, occurrence_key, local_date,
         scheduled_for, due_at, deadline_at, status, completed_at, snoozed_until,
         generated_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        mutation.entityId,
        taskId,
        nullableString(
          fields.get('scheduleVersionId'),
          'task instance scheduleVersionId',
        ),
        nullableString(fields.get('slotId'), 'task instance slotId'),
        occurrenceKey,
        requiredString(fields.get('localDate'), 'task instance localDate'),
        nullableNumber(
          fields.get('scheduledFor'),
          'task instance scheduledFor',
        ),
        nullableNumber(fields.get('dueAt'), 'task instance dueAt'),
        nullableNumber(fields.get('deadlineAt'), 'task instance deadlineAt'),
        status,
        completedAt,
        nullableNumber(
          fields.get('snoozedUntil'),
          'task instance snoozedUntil',
        ),
        timestamp,
        fields.has('updatedAt')
          ? requiredNumber(fields.get('updatedAt'), 'task instance updatedAt')
          : timestamp,
      ],
    );
    return;
  }
  await updateMappedFields(
    executor,
    'task_instances',
    'id',
    mutation.entityId,
    fields,
    {
      taskId: stringColumn('task_id'),
      scheduleVersionId: nullableStringColumn('schedule_version_id'),
      slotId: nullableStringColumn('slot_id'),
      occurrenceKey: stringColumn('occurrence_key'),
      localDate: stringColumn('local_date'),
      scheduledFor: nullableNumberColumn('scheduled_for'),
      dueAt: nullableNumberColumn('due_at'),
      deadlineAt: nullableNumberColumn('deadline_at'),
      status: stringColumn('status'),
      completedAt: nullableNumberColumn('completed_at'),
      snoozedUntil: nullableNumberColumn('snoozed_until'),
      updatedAt: numberColumn('updated_at'),
    },
  );
}

async function upsertTaskInstanceSubtask(
  executor: SqlExecutor,
  mutation: SyncMutationEnvelope,
  fields: AcceptedFields,
): Promise<void> {
  const [fallbackInstanceId, fallbackSubtaskId] = mutation.entityId.split(
    ':',
    2,
  );
  const taskInstanceId =
    typeof fields.get('taskInstanceId') === 'string'
      ? (fields.get('taskInstanceId') as string)
      : fallbackInstanceId;
  const subtaskId =
    typeof fields.get('subtaskId') === 'string'
      ? (fields.get('subtaskId') as string)
      : fallbackSubtaskId;
  if (!taskInstanceId || !subtaskId) {
    throw new SyncIntegrityError(
      'A task instance subtask has an invalid entity ID.',
    );
  }
  const completed = integerFlag(fields.get('completed'), false);
  const timestamp = fields.has('updatedAt')
    ? requiredNumber(fields.get('updatedAt'), 'task subtask updatedAt')
    : mutationTime(mutation);
  await executor.runAsync(
    `INSERT INTO task_instance_subtasks
      (task_instance_id, subtask_id, completed, completed_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(task_instance_id, subtask_id) DO UPDATE SET
       completed = excluded.completed,
       completed_at = excluded.completed_at,
       updated_at = excluded.updated_at`,
    [
      taskInstanceId,
      subtaskId,
      completed,
      fields.has('completedAt')
        ? nullableNumber(fields.get('completedAt'), 'task subtask completedAt')
        : completed === 1
          ? timestamp
          : null,
      timestamp,
    ],
  );
}

async function resetRoutineRunSteps(
  executor: SqlExecutor,
  routineRunId: string,
  timestamp: number,
): Promise<void> {
  await executor.runAsync(
    `UPDATE routine_run_steps
     SET status = 'pending', started_at = NULL, finished_at = NULL,
         elapsed_seconds = 0, note = NULL, updated_at = ?
     WHERE routine_run_id = ?`,
    [timestamp, routineRunId],
  );
}

async function upsertRoutineRun(
  executor: SqlExecutor,
  mutation: SyncMutationEnvelope,
  fields: AcceptedFields,
): Promise<void> {
  const timestamp = mutationTime(mutation);
  const existing = await executor.getFirstAsync<{ id: string }>(
    'SELECT id FROM routine_runs WHERE id = ?',
    [mutation.entityId],
  );
  if (!existing) {
    const routineId = requiredString(
      fields.get('routineId'),
      'routine run routineId',
    );
    const occurrenceKey = nullableString(
      fields.get('occurrenceKey'),
      'routine run occurrenceKey',
    );
    if (occurrenceKey) {
      const logical = await executor.getFirstAsync<{ id: string }>(
        `SELECT id FROM routine_runs
         WHERE routine_id = ? AND occurrence_key = ?`,
        [routineId, occurrenceKey],
      );
      if (logical && logical.id !== mutation.entityId) {
        await executor.runAsync('DELETE FROM routine_runs WHERE id = ?', [
          logical.id,
        ]);
      }
    }
    const startedAt = fields.has('startedAt')
      ? requiredNumber(fields.get('startedAt'), 'routine run startedAt')
      : timestamp;
    await executor.runAsync(
      `INSERT INTO routine_runs
        (id, routine_id, schedule_version_id, slot_id, occurrence_key,
         local_date, status, started_at, finished_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        mutation.entityId,
        routineId,
        nullableString(
          fields.get('scheduleVersionId'),
          'routine run scheduleVersionId',
        ),
        nullableString(fields.get('slotId'), 'routine run slotId'),
        occurrenceKey,
        requiredString(fields.get('localDate'), 'routine run localDate'),
        stringOr(fields.get('status'), 'running'),
        startedAt,
        nullableNumber(fields.get('finishedAt'), 'routine run finishedAt'),
        fields.has('updatedAt')
          ? requiredNumber(fields.get('updatedAt'), 'routine run updatedAt')
          : timestamp,
      ],
    );
    if (fields.has('stepIds')) {
      for (const value of arrayValue(
        fields.get('stepIds'),
        'routine run stepIds',
      )) {
        const stepId = requiredString(value, 'routine run step id');
        await executor.runAsync(
          `INSERT INTO routine_run_steps
            (routine_run_id, step_id, status, elapsed_seconds, updated_at)
           VALUES (?, ?, 'pending', 0, ?)
           ON CONFLICT(routine_run_id, step_id) DO NOTHING`,
          [mutation.entityId, stepId, timestamp],
        );
      }
    }
    return;
  }

  await updateMappedFields(
    executor,
    'routine_runs',
    'id',
    mutation.entityId,
    fields,
    {
      routineId: stringColumn('routine_id'),
      scheduleVersionId: nullableStringColumn('schedule_version_id'),
      slotId: nullableStringColumn('slot_id'),
      occurrenceKey: nullableStringColumn('occurrence_key'),
      localDate: stringColumn('local_date'),
      status: stringColumn('status'),
      startedAt: numberColumn('started_at'),
      finishedAt: nullableNumberColumn('finished_at'),
      updatedAt: numberColumn('updated_at'),
    },
  );

  const legacyReopen =
    fields.has('runId') &&
    fields.has('startedAt') &&
    !fields.has('routineId') &&
    !fields.has('status');
  const resetSteps =
    fields.get('resetSteps') === true || fields.has('steps') || legacyReopen;
  if (legacyReopen) {
    await executor.runAsync(
      `UPDATE routine_runs
       SET status = 'running', finished_at = NULL, updated_at = ?
       WHERE id = ?`,
      [timestamp, mutation.entityId],
    );
  }
  if (fields.get('status') === 'abandoned' && !fields.has('finishedAt')) {
    await executor.runAsync(
      'UPDATE routine_runs SET finished_at = ?, updated_at = ? WHERE id = ?',
      [timestamp, timestamp, mutation.entityId],
    );
  }
  if (resetSteps)
    await resetRoutineRunSteps(executor, mutation.entityId, timestamp);
}

async function upsertRoutineRunStep(
  executor: SqlExecutor,
  mutation: SyncMutationEnvelope,
  fields: AcceptedFields,
): Promise<void> {
  const [fallbackRunId, fallbackStepId] = mutation.entityId.split(':', 2);
  const routineRunId =
    typeof fields.get('routineRunId') === 'string'
      ? (fields.get('routineRunId') as string)
      : fallbackRunId;
  const stepId =
    typeof fields.get('stepId') === 'string'
      ? (fields.get('stepId') as string)
      : fallbackStepId;
  if (!routineRunId || !stepId) {
    throw new SyncIntegrityError(
      'A routine run step has an invalid entity ID.',
    );
  }
  const timestamp = fields.has('updatedAt')
    ? requiredNumber(fields.get('updatedAt'), 'routine step updatedAt')
    : mutationTime(mutation);
  await executor.runAsync(
    `INSERT INTO routine_run_steps
      (routine_run_id, step_id, status, started_at, finished_at,
       elapsed_seconds, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(routine_run_id, step_id) DO UPDATE SET
       status = excluded.status,
       started_at = excluded.started_at,
       finished_at = excluded.finished_at,
       elapsed_seconds = excluded.elapsed_seconds,
       note = excluded.note,
       updated_at = excluded.updated_at`,
    [
      routineRunId,
      stepId,
      requiredString(fields.get('status'), 'routine step status'),
      nullableNumber(fields.get('startedAt'), 'routine step startedAt'),
      nullableNumber(fields.get('finishedAt'), 'routine step finishedAt'),
      fields.has('elapsedSeconds')
        ? requiredNumber(
            fields.get('elapsedSeconds'),
            'routine step elapsedSeconds',
          )
        : 0,
      nullableString(fields.get('note'), 'routine step note'),
      timestamp,
    ],
  );
}

async function upsertReminderRule(
  executor: SqlExecutor,
  mutation: SyncMutationEnvelope,
  fields: AcceptedFields,
): Promise<void> {
  const timestamp = mutationTime(mutation);
  const existing = await executor.getFirstAsync<{ id: string }>(
    'SELECT id FROM reminder_rules WHERE id = ?',
    [mutation.entityId],
  );
  if (!existing) {
    await executor.runAsync(
      `INSERT INTO reminder_rules
        (id, item_id, schedule_slot_id, enabled, trigger_type, local_time,
         offset_minutes, exact_alarm, allow_complete, allow_snooze,
         snooze_minutes, repeat_until_completed, repeat_interval_minutes,
         android_notification_key, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        mutation.entityId,
        requiredString(fields.get('itemId'), 'reminder rule itemId'),
        nullableString(
          fields.get('scheduleSlotId'),
          'reminder rule scheduleSlotId',
        ),
        integerFlag(fields.get('enabled'), true),
        stringOr(fields.get('triggerType'), 'scheduled'),
        nullableString(fields.get('localTime'), 'reminder rule localTime'),
        fields.has('offsetMinutes')
          ? requiredNumber(
              fields.get('offsetMinutes'),
              'reminder rule offsetMinutes',
            )
          : 0,
        integerFlag(fields.get('exactAlarm'), true),
        integerFlag(fields.get('allowComplete'), true),
        integerFlag(fields.get('allowSnooze'), true),
        fields.has('snoozeMinutes')
          ? requiredNumber(
              fields.get('snoozeMinutes'),
              'reminder rule snoozeMinutes',
            )
          : 10,
        integerFlag(fields.get('repeatUntilCompleted'), false),
        nullableNumber(
          fields.get('repeatIntervalMinutes'),
          'reminder rule repeatIntervalMinutes',
        ),
        nullableString(
          fields.get('androidNotificationKey'),
          'reminder rule notification key',
        ),
        timestamp,
        fields.has('updatedAt')
          ? requiredNumber(fields.get('updatedAt'), 'reminder rule updatedAt')
          : timestamp,
      ],
    );
    return;
  }
  await updateMappedFields(
    executor,
    'reminder_rules',
    'id',
    mutation.entityId,
    fields,
    {
      itemId: stringColumn('item_id'),
      scheduleSlotId: nullableStringColumn('schedule_slot_id'),
      enabled: booleanColumn('enabled'),
      triggerType: stringColumn('trigger_type'),
      localTime: nullableStringColumn('local_time'),
      offsetMinutes: numberColumn('offset_minutes'),
      exactAlarm: booleanColumn('exact_alarm'),
      allowComplete: booleanColumn('allow_complete'),
      allowSnooze: booleanColumn('allow_snooze'),
      snoozeMinutes: numberColumn('snooze_minutes'),
      repeatUntilCompleted: booleanColumn('repeat_until_completed'),
      repeatIntervalMinutes: nullableNumberColumn('repeat_interval_minutes'),
      androidNotificationKey: nullableStringColumn('android_notification_key'),
      updatedAt: numberColumn('updated_at'),
    },
    ['deleted_at = NULL'],
  );
}

async function upsertReminderDelivery(
  executor: SqlExecutor,
  mutation: SyncMutationEnvelope,
  fields: AcceptedFields,
): Promise<void> {
  const timestamp = mutationTime(mutation);
  const reminderRuleId =
    typeof fields.get('reminderRuleId') === 'string'
      ? (fields.get('reminderRuleId') as string)
      : requiredString(
          fields.get('reminderId'),
          'reminder delivery reminderId',
        );
  await executor.runAsync(
    `INSERT INTO reminder_deliveries
      (id, reminder_rule_id, occurrence_key, scheduled_at, delivered_at,
       acted_at, action, notification_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       reminder_rule_id = excluded.reminder_rule_id,
       occurrence_key = excluded.occurrence_key,
       scheduled_at = excluded.scheduled_at,
       delivered_at = excluded.delivered_at,
       acted_at = excluded.acted_at,
       action = excluded.action`,
    [
      mutation.entityId,
      reminderRuleId,
      requiredString(
        fields.get('occurrenceKey'),
        'reminder delivery occurrenceKey',
      ),
      requiredNumber(
        fields.get('scheduledAt'),
        'reminder delivery scheduledAt',
      ),
      nullableNumber(
        fields.get('deliveredAt'),
        'reminder delivery deliveredAt',
      ),
      fields.has('actedAt')
        ? nullableNumber(fields.get('actedAt'), 'reminder delivery actedAt')
        : timestamp,
      stringOr(fields.get('action'), 'snooze'),
    ],
  );
}

async function upsertSchedule(
  executor: SqlExecutor,
  mutation: SyncMutationEnvelope,
  fields: AcceptedFields,
): Promise<void> {
  const timestamp = mutationTime(mutation);
  const existing = await executor.getFirstAsync<{ id: string }>(
    'SELECT id FROM schedules WHERE id = ?',
    [mutation.entityId],
  );
  if (!existing) {
    await executor.runAsync(
      `INSERT INTO schedules (id, item_id, timezone, created_at, retired_at)
       VALUES (?, ?, ?, ?, NULL)`,
      [
        mutation.entityId,
        requiredString(fields.get('itemId'), 'schedule itemId'),
        stringOr(fields.get('timezone'), 'UTC'),
        timestamp,
      ],
    );
  }
  const version = objectValue(fields.get('version'), 'schedule version');
  const versionId = requiredString(
    fields.get('versionId'),
    'schedule versionId',
  );
  const versionNumber = requiredNumber(
    fields.get('versionNumber'),
    'schedule versionNumber',
  );
  const existingVersion = await executor.getFirstAsync<{ id: string }>(
    'SELECT id FROM schedule_versions WHERE id = ?',
    [versionId],
  );
  if (existingVersion) {
    await executor.runAsync(
      'DELETE FROM schedule_goals WHERE schedule_version_id = ?',
      [versionId],
    );
    await executor.runAsync(
      'DELETE FROM schedule_slots WHERE schedule_version_id = ?',
      [versionId],
    );
  }
  await executor.runAsync(
    `UPDATE schedule_versions
     SET effective_until = date(?, '-1 day')
     WHERE schedule_id = ? AND version_number = ?`,
    [
      requiredString(version.effectiveFrom, 'schedule effectiveFrom'),
      mutation.entityId,
      versionNumber - 1,
    ],
  );
  await upsertScheduleVersion(
    executor,
    mutation.entityId,
    versionId,
    versionNumber,
    version,
    fields.get('slots'),
    fields.get('goals'),
    timestamp,
  );
  await executor.runAsync(
    'UPDATE schedules SET retired_at = NULL WHERE id = ?',
    [mutation.entityId],
  );
}

export async function upsertMaterializedEntity(
  executor: SqlExecutor,
  mutation: SyncMutationEnvelope,
  accepted: readonly EntityField[],
): Promise<void> {
  const fields = fieldsMap(accepted);
  switch (mutation.entityType) {
    case 'category':
      return upsertNamedMetadata(executor, mutation, fields, 'categories');
    case 'tag':
      return upsertNamedMetadata(executor, mutation, fields, 'tags');
    case 'item':
      return upsertItem(executor, mutation, fields);
    case 'habit':
      return upsertHabit(executor, mutation, fields);
    case 'dashboard_layout':
      return upsertDashboardLayout(executor, mutation, fields);
    case 'item_pause':
      return upsertItemPause(executor, mutation, fields);
    case 'measurement':
      return upsertMeasurement(executor, mutation, fields);
    case 'occurrence_override':
      return upsertOccurrenceOverride(executor, mutation, fields);
    case 'task_instance':
      return upsertTaskInstance(executor, mutation, fields);
    case 'task_instance_subtask':
      return upsertTaskInstanceSubtask(executor, mutation, fields);
    case 'routine_run':
      return upsertRoutineRun(executor, mutation, fields);
    case 'routine_run_step':
      return upsertRoutineRunStep(executor, mutation, fields);
    case 'reminder_rule':
      return upsertReminderRule(executor, mutation, fields);
    case 'reminder_delivery':
      return upsertReminderDelivery(executor, mutation, fields);
    case 'schedule':
      return upsertSchedule(executor, mutation, fields);
    default:
      throw new SyncIntegrityError(
        `Unsupported synchronized entity type ${mutation.entityType}.`,
      );
  }
}

export async function deleteMaterializedEntity(
  executor: SqlExecutor,
  mutation: SyncMutationEnvelope,
): Promise<void> {
  const timestamp = mutationTime(mutation);
  switch (mutation.entityType) {
    case 'item':
      await executor.runAsync(
        `UPDATE items
         SET deleted_at = ?, updated_at = MAX(updated_at, ?)
         WHERE id = ?`,
        [timestamp, timestamp, mutation.entityId],
      );
      return;
    case 'category':
      await executor.runAsync(
        `UPDATE categories
         SET deleted_at = ?, updated_at = MAX(updated_at, ?)
         WHERE id = ?`,
        [timestamp, timestamp, mutation.entityId],
      );
      return;
    case 'tag':
      await executor.runAsync(
        `UPDATE tags
         SET deleted_at = ?, updated_at = MAX(updated_at, ?)
         WHERE id = ?`,
        [timestamp, timestamp, mutation.entityId],
      );
      return;
    case 'measurement':
      await executor.runAsync(
        `UPDATE measurements
         SET deleted_at = ?, updated_at = MAX(updated_at, ?)
         WHERE id = ?`,
        [timestamp, timestamp, mutation.entityId],
      );
      return;
    case 'reminder_rule':
      await executor.runAsync(
        `UPDATE reminder_rules
         SET deleted_at = ?, updated_at = MAX(updated_at, ?), enabled = 0
         WHERE id = ?`,
        [timestamp, timestamp, mutation.entityId],
      );
      return;
    case 'dashboard_layout':
      await executor.runAsync(
        'DELETE FROM dashboard_layout WHERE workspace_id = ?',
        [mutation.entityId],
      );
      return;
    case 'item_pause':
      await executor.runAsync('DELETE FROM item_pauses WHERE id = ?', [
        mutation.entityId,
      ]);
      return;
    case 'occurrence_override':
      await executor.runAsync('DELETE FROM occurrence_overrides WHERE id = ?', [
        mutation.entityId,
      ]);
      return;
    case 'task_instance':
      await executor.runAsync('DELETE FROM task_instances WHERE id = ?', [
        mutation.entityId,
      ]);
      return;
    case 'task_instance_subtask': {
      const [taskInstanceId, subtaskId] = mutation.entityId.split(':', 2);
      await executor.runAsync(
        `DELETE FROM task_instance_subtasks
         WHERE task_instance_id = ? AND subtask_id = ?`,
        [taskInstanceId, subtaskId],
      );
      return;
    }
    case 'routine_run':
      await executor.runAsync('DELETE FROM routine_runs WHERE id = ?', [
        mutation.entityId,
      ]);
      return;
    case 'routine_run_step': {
      const [routineRunId, stepId] = mutation.entityId.split(':', 2);
      await executor.runAsync(
        `DELETE FROM routine_run_steps
         WHERE routine_run_id = ? AND step_id = ?`,
        [routineRunId, stepId],
      );
      return;
    }
    case 'reminder_delivery':
      await executor.runAsync('DELETE FROM reminder_deliveries WHERE id = ?', [
        mutation.entityId,
      ]);
      return;
    case 'schedule':
      await executor.runAsync(
        'UPDATE schedules SET retired_at = ? WHERE id = ?',
        [timestamp, mutation.entityId],
      );
      return;
    case 'habit':
      throw new SyncIntegrityError(
        'Habit subtype deletion has no materialized semantics.',
      );
    default:
      throw new SyncIntegrityError(
        `Unsupported synchronized entity type ${mutation.entityType}.`,
      );
  }
}

export async function entityExists(
  executor: SqlExecutor,
  entityType: string,
  entityId: string,
): Promise<boolean> {
  let query: string;
  let params: readonly SqlValue[] = [entityId];
  switch (entityType) {
    case 'category':
      query = 'SELECT 1 AS found FROM categories WHERE id = ?';
      break;
    case 'tag':
      query = 'SELECT 1 AS found FROM tags WHERE id = ?';
      break;
    case 'item':
      query = 'SELECT 1 AS found FROM items WHERE id = ?';
      break;
    case 'habit':
      query = 'SELECT 1 AS found FROM habits WHERE item_id = ?';
      break;
    case 'dashboard_layout':
      query =
        'SELECT 1 AS found FROM dashboard_layout WHERE workspace_id = ? LIMIT 1';
      break;
    case 'item_pause':
      query = 'SELECT 1 AS found FROM item_pauses WHERE id = ?';
      break;
    case 'measurement':
      query = 'SELECT 1 AS found FROM measurements WHERE id = ?';
      break;
    case 'occurrence_override':
      query = 'SELECT 1 AS found FROM occurrence_overrides WHERE id = ?';
      break;
    case 'task_instance':
      query = 'SELECT 1 AS found FROM task_instances WHERE id = ?';
      break;
    case 'task_instance_subtask': {
      const [taskInstanceId, subtaskId] = entityId.split(':', 2);
      query =
        'SELECT 1 AS found FROM task_instance_subtasks WHERE task_instance_id = ? AND subtask_id = ?';
      params = [taskInstanceId, subtaskId];
      break;
    }
    case 'routine_run':
      query = 'SELECT 1 AS found FROM routine_runs WHERE id = ?';
      break;
    case 'routine_run_step': {
      const [routineRunId, stepId] = entityId.split(':', 2);
      query =
        'SELECT 1 AS found FROM routine_run_steps WHERE routine_run_id = ? AND step_id = ?';
      params = [routineRunId, stepId];
      break;
    }
    case 'reminder_rule':
      query = 'SELECT 1 AS found FROM reminder_rules WHERE id = ?';
      break;
    case 'reminder_delivery':
      query = 'SELECT 1 AS found FROM reminder_deliveries WHERE id = ?';
      break;
    case 'schedule':
      query = 'SELECT 1 AS found FROM schedules WHERE id = ?';
      break;
    default:
      throw new SyncIntegrityError(
        `Unsupported synchronized entity type ${entityType}.`,
      );
  }
  return (
    (await executor.getFirstAsync<{ found: number }>(query, [...params])) !==
    null
  );
}
