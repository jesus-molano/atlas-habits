import type { SQLiteDatabase } from 'expo-sqlite';

import { withWriteTransaction } from './transaction';

export type Migration = Readonly<{
  version: number;
  name: string;
  sql: string;
}>;

export const DATABASE_VERSION = 6;

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'core_items_and_schedules',
    sql: `
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        remote_id TEXT,
        created_at INTEGER NOT NULL CHECK(created_at >= 0),
        updated_at INTEGER NOT NULL CHECK(updated_at >= 0)
      );

      INSERT INTO workspaces (id, name, created_at, updated_at)
      VALUES ('local-personal', 'Personal', 0, 0);

      CREATE TABLE categories (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT,
        icon TEXT,
        sort_order REAL NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL CHECK(created_at >= 0),
        updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
        deleted_at INTEGER CHECK(deleted_at IS NULL OR deleted_at >= 0)
      );
      CREATE UNIQUE INDEX categories_name_active_unique
        ON categories(workspace_id, name COLLATE NOCASE)
        WHERE deleted_at IS NULL;

      CREATE TABLE tags (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT,
        created_at INTEGER NOT NULL CHECK(created_at >= 0),
        updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
        deleted_at INTEGER CHECK(deleted_at IS NULL OR deleted_at >= 0)
      );
      CREATE UNIQUE INDEX tags_name_active_unique
        ON tags(workspace_id, name COLLATE NOCASE)
        WHERE deleted_at IS NULL;

      CREATE TABLE items (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('habit', 'task', 'routine')),
        title TEXT NOT NULL CHECK(length(trim(title)) > 0),
        notes TEXT,
        color TEXT,
        icon TEXT,
        category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        sort_order REAL NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL CHECK(created_at >= 0),
        updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
        archived_at INTEGER CHECK(archived_at IS NULL OR archived_at >= created_at),
        deleted_at INTEGER CHECK(deleted_at IS NULL OR deleted_at >= created_at)
      );
      CREATE INDEX items_dashboard_order
        ON items(workspace_id, archived_at, deleted_at, sort_order, created_at);
      CREATE INDEX items_category_id ON items(category_id);

      CREATE TABLE item_tags (
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL CHECK(created_at >= 0),
        PRIMARY KEY(item_id, tag_id)
      ) WITHOUT ROWID;
      CREATE INDEX item_tags_tag_id ON item_tags(tag_id);

      CREATE TABLE habits (
        item_id TEXT PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        measurement_type TEXT NOT NULL
          CHECK(measurement_type IN ('boolean', 'quantity', 'duration')),
        unit TEXT,
        default_value REAL NOT NULL DEFAULT 1 CHECK(default_value >= 0),
        timer_started_at INTEGER CHECK(timer_started_at IS NULL OR timer_started_at >= 0)
      );

      CREATE TABLE tasks (
        item_id TEXT PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        priority INTEGER NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 3),
        all_day INTEGER NOT NULL DEFAULT 1 CHECK(all_day IN (0, 1)),
        due_at INTEGER CHECK(due_at IS NULL OR due_at >= 0),
        deadline_at INTEGER CHECK(deadline_at IS NULL OR deadline_at >= 0),
        CHECK(deadline_at IS NULL OR due_at IS NULL OR deadline_at >= due_at)
      );

      CREATE TABLE routines (
        item_id TEXT PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        completion_policy TEXT NOT NULL DEFAULT 'all_required'
          CHECK(completion_policy IN ('all_required', 'manual'))
      );

      CREATE TRIGGER habits_require_habit_item
      BEFORE INSERT ON habits
      WHEN (SELECT type FROM items WHERE id = NEW.item_id) IS NOT 'habit'
      BEGIN
        SELECT RAISE(ABORT, 'habit subtype requires a habit item');
      END;
      CREATE TRIGGER tasks_require_task_item
      BEFORE INSERT ON tasks
      WHEN (SELECT type FROM items WHERE id = NEW.item_id) IS NOT 'task'
      BEGIN
        SELECT RAISE(ABORT, 'task subtype requires a task item');
      END;
      CREATE TRIGGER routines_require_routine_item
      BEFORE INSERT ON routines
      WHEN (SELECT type FROM items WHERE id = NEW.item_id) IS NOT 'routine'
      BEGIN
        SELECT RAISE(ABORT, 'routine subtype requires a routine item');
      END;

      CREATE TABLE schedules (
        id TEXT PRIMARY KEY NOT NULL,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        timezone TEXT NOT NULL,
        created_at INTEGER NOT NULL CHECK(created_at >= 0),
        retired_at INTEGER CHECK(retired_at IS NULL OR retired_at >= created_at)
      );
      CREATE INDEX schedules_item_id ON schedules(item_id, retired_at);

      CREATE TABLE schedule_versions (
        id TEXT PRIMARY KEY NOT NULL,
        schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL CHECK(version_number > 0),
        effective_from TEXT NOT NULL
          CHECK(length(effective_from) = 10),
        effective_until TEXT
          CHECK(effective_until IS NULL OR (length(effective_until) = 10 AND effective_until >= effective_from)),
        rule_type TEXT NOT NULL
          CHECK(rule_type IN ('once', 'daily', 'weekdays', 'interval', 'period_quota')),
        rule_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(rule_json)),
        grace_minutes INTEGER NOT NULL DEFAULT 0 CHECK(grace_minutes >= 0),
        created_at INTEGER NOT NULL CHECK(created_at >= 0),
        UNIQUE(schedule_id, version_number)
      );
      CREATE INDEX schedule_versions_effective
        ON schedule_versions(schedule_id, effective_from, effective_until);

      CREATE TABLE schedule_slots (
        id TEXT PRIMARY KEY NOT NULL,
        schedule_version_id TEXT NOT NULL REFERENCES schedule_versions(id) ON DELETE CASCADE,
        slot_key TEXT NOT NULL CHECK(length(trim(slot_key)) > 0),
        label TEXT,
        local_time TEXT
          CHECK(local_time IS NULL OR (length(local_time) = 5 AND substr(local_time, 3, 1) = ':')),
        sort_order REAL NOT NULL DEFAULT 0,
        UNIQUE(schedule_version_id, slot_key)
      );
      CREATE INDEX schedule_slots_version_order
        ON schedule_slots(schedule_version_id, sort_order);

      CREATE TABLE schedule_goals (
        id TEXT PRIMARY KEY NOT NULL,
        schedule_version_id TEXT NOT NULL REFERENCES schedule_versions(id) ON DELETE CASCADE,
        slot_id TEXT REFERENCES schedule_slots(id) ON DELETE CASCADE,
        measurement_type TEXT NOT NULL
          CHECK(measurement_type IN ('boolean', 'quantity', 'duration')),
        aggregation TEXT NOT NULL DEFAULT 'sum'
          CHECK(aggregation IN ('count', 'sum', 'duration')),
        comparison TEXT NOT NULL DEFAULT 'at_least'
          CHECK(comparison IN ('at_least', 'at_most', 'exactly')),
        target_value REAL NOT NULL CHECK(target_value >= 0),
        unit TEXT
      );
      CREATE INDEX schedule_goals_version_id ON schedule_goals(schedule_version_id, slot_id);
    `,
  },
  {
    version: 2,
    name: 'activity_tasks_routines_and_reminders',
    sql: `
      CREATE TABLE measurements (
        id TEXT PRIMARY KEY NOT NULL,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        occurrence_key TEXT,
        session_id TEXT,
        schedule_version_id TEXT REFERENCES schedule_versions(id) ON DELETE SET NULL,
        slot_id TEXT REFERENCES schedule_slots(id) ON DELETE SET NULL,
        value REAL NOT NULL CHECK(value >= 0),
        operation TEXT NOT NULL DEFAULT 'add' CHECK(operation IN ('add', 'set')),
        unit TEXT,
        occurred_at INTEGER NOT NULL CHECK(occurred_at >= 0),
        local_date TEXT NOT NULL CHECK(length(local_date) = 10),
        started_at INTEGER CHECK(started_at IS NULL OR started_at >= 0),
        ended_at INTEGER CHECK(ended_at IS NULL OR ended_at >= started_at),
        source TEXT NOT NULL DEFAULT 'app'
          CHECK(source IN ('app', 'notification', 'widget', 'timer', 'sync', 'import')),
        note TEXT,
        created_at INTEGER NOT NULL CHECK(created_at >= 0),
        updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
        deleted_at INTEGER CHECK(deleted_at IS NULL OR deleted_at >= created_at)
      );
      CREATE INDEX measurements_item_day
        ON measurements(item_id, local_date, deleted_at, occurred_at);
      CREATE INDEX measurements_occurrence
        ON measurements(item_id, occurrence_key, deleted_at);

      CREATE TABLE occurrence_overrides (
        id TEXT NOT NULL UNIQUE,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        occurrence_key TEXT NOT NULL,
        local_date TEXT NOT NULL CHECK(length(local_date) = 10),
        slot_id TEXT REFERENCES schedule_slots(id) ON DELETE SET NULL,
        state TEXT NOT NULL
          CHECK(state IN ('complete', 'excused', 'reset', 'force_due', 'force_not_due')),
        value REAL CHECK(value IS NULL OR value >= 0),
        note TEXT,
        created_at INTEGER NOT NULL CHECK(created_at >= 0),
        updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
        PRIMARY KEY(item_id, occurrence_key)
      ) WITHOUT ROWID;
      CREATE INDEX occurrence_overrides_day ON occurrence_overrides(local_date, item_id);

      CREATE TABLE item_pauses (
        id TEXT PRIMARY KEY NOT NULL,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        start_date TEXT NOT NULL CHECK(length(start_date) = 10),
        end_date TEXT CHECK(end_date IS NULL OR (length(end_date) = 10 AND end_date >= start_date)),
        reason TEXT,
        created_at INTEGER NOT NULL CHECK(created_at >= 0)
      );
      CREATE INDEX item_pauses_range ON item_pauses(item_id, start_date, end_date);

      CREATE TABLE task_subtasks (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL REFERENCES tasks(item_id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK(length(trim(title)) > 0),
        sort_order REAL NOT NULL DEFAULT 0,
        required INTEGER NOT NULL DEFAULT 1 CHECK(required IN (0, 1)),
        created_at INTEGER NOT NULL CHECK(created_at >= 0),
        updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
        deleted_at INTEGER CHECK(deleted_at IS NULL OR deleted_at >= created_at)
      );
      CREATE INDEX task_subtasks_order ON task_subtasks(task_id, deleted_at, sort_order);

      CREATE TABLE task_instances (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL REFERENCES tasks(item_id) ON DELETE CASCADE,
        schedule_version_id TEXT REFERENCES schedule_versions(id) ON DELETE SET NULL,
        slot_id TEXT REFERENCES schedule_slots(id) ON DELETE SET NULL,
        occurrence_key TEXT NOT NULL,
        local_date TEXT NOT NULL CHECK(length(local_date) = 10),
        scheduled_for INTEGER CHECK(scheduled_for IS NULL OR scheduled_for >= 0),
        due_at INTEGER CHECK(due_at IS NULL OR due_at >= 0),
        deadline_at INTEGER CHECK(deadline_at IS NULL OR deadline_at >= 0),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'completed', 'skipped', 'cancelled')),
        completed_at INTEGER CHECK(completed_at IS NULL OR completed_at >= 0),
        snoozed_until INTEGER CHECK(snoozed_until IS NULL OR snoozed_until >= 0),
        generated_at INTEGER NOT NULL CHECK(generated_at >= 0),
        updated_at INTEGER NOT NULL CHECK(updated_at >= generated_at),
        UNIQUE(task_id, occurrence_key)
      );
      CREATE INDEX task_instances_day_status
        ON task_instances(local_date, status, scheduled_for, due_at);

      CREATE TABLE task_instance_subtasks (
        task_instance_id TEXT NOT NULL REFERENCES task_instances(id) ON DELETE CASCADE,
        subtask_id TEXT NOT NULL REFERENCES task_subtasks(id) ON DELETE CASCADE,
        completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
        completed_at INTEGER CHECK(completed_at IS NULL OR completed_at >= 0),
        updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
        PRIMARY KEY(task_instance_id, subtask_id)
      ) WITHOUT ROWID;

      CREATE TABLE routine_steps (
        id TEXT PRIMARY KEY NOT NULL,
        routine_id TEXT NOT NULL REFERENCES routines(item_id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK(length(trim(title)) > 0),
        notes TEXT,
        sort_order REAL NOT NULL DEFAULT 0,
        required INTEGER NOT NULL DEFAULT 1 CHECK(required IN (0, 1)),
        duration_seconds INTEGER CHECK(duration_seconds IS NULL OR duration_seconds >= 0),
        created_at INTEGER NOT NULL CHECK(created_at >= 0),
        updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
        deleted_at INTEGER CHECK(deleted_at IS NULL OR deleted_at >= created_at)
      );
      CREATE INDEX routine_steps_order ON routine_steps(routine_id, deleted_at, sort_order);

      CREATE TABLE routine_runs (
        id TEXT PRIMARY KEY NOT NULL,
        routine_id TEXT NOT NULL REFERENCES routines(item_id) ON DELETE CASCADE,
        schedule_version_id TEXT REFERENCES schedule_versions(id) ON DELETE SET NULL,
        slot_id TEXT REFERENCES schedule_slots(id) ON DELETE SET NULL,
        occurrence_key TEXT,
        local_date TEXT NOT NULL CHECK(length(local_date) = 10),
        status TEXT NOT NULL DEFAULT 'running'
          CHECK(status IN ('running', 'completed', 'abandoned')),
        started_at INTEGER NOT NULL CHECK(started_at >= 0),
        finished_at INTEGER CHECK(finished_at IS NULL OR finished_at >= started_at),
        updated_at INTEGER NOT NULL CHECK(updated_at >= started_at)
      );
      CREATE UNIQUE INDEX routine_runs_occurrence
        ON routine_runs(routine_id, occurrence_key)
        WHERE occurrence_key IS NOT NULL;
      CREATE INDEX routine_runs_day ON routine_runs(local_date, routine_id, status);

      CREATE TABLE routine_run_steps (
        routine_run_id TEXT NOT NULL REFERENCES routine_runs(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL REFERENCES routine_steps(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'running', 'completed', 'skipped')),
        started_at INTEGER CHECK(started_at IS NULL OR started_at >= 0),
        finished_at INTEGER CHECK(finished_at IS NULL OR finished_at >= started_at),
        elapsed_seconds INTEGER NOT NULL DEFAULT 0 CHECK(elapsed_seconds >= 0),
        note TEXT,
        updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
        PRIMARY KEY(routine_run_id, step_id)
      ) WITHOUT ROWID;

      CREATE TABLE reminder_rules (
        id TEXT PRIMARY KEY NOT NULL,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        schedule_slot_id TEXT REFERENCES schedule_slots(id) ON DELETE SET NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
        trigger_type TEXT NOT NULL DEFAULT 'scheduled'
          CHECK(trigger_type IN ('scheduled', 'before_due', 'after_due')),
        local_time TEXT
          CHECK(local_time IS NULL OR (length(local_time) = 5 AND substr(local_time, 3, 1) = ':')),
        offset_minutes INTEGER NOT NULL DEFAULT 0,
        exact_alarm INTEGER NOT NULL DEFAULT 0 CHECK(exact_alarm IN (0, 1)),
        allow_complete INTEGER NOT NULL DEFAULT 1 CHECK(allow_complete IN (0, 1)),
        allow_snooze INTEGER NOT NULL DEFAULT 1 CHECK(allow_snooze IN (0, 1)),
        snooze_minutes INTEGER NOT NULL DEFAULT 10 CHECK(snooze_minutes > 0),
        repeat_until_completed INTEGER NOT NULL DEFAULT 0 CHECK(repeat_until_completed IN (0, 1)),
        repeat_interval_minutes INTEGER CHECK(repeat_interval_minutes IS NULL OR repeat_interval_minutes > 0),
        android_notification_key TEXT,
        created_at INTEGER NOT NULL CHECK(created_at >= 0),
        updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
        deleted_at INTEGER CHECK(deleted_at IS NULL OR deleted_at >= created_at)
      );
      CREATE INDEX reminder_rules_item_enabled
        ON reminder_rules(item_id, enabled, deleted_at);

      CREATE TABLE reminder_deliveries (
        id TEXT PRIMARY KEY NOT NULL,
        reminder_rule_id TEXT NOT NULL REFERENCES reminder_rules(id) ON DELETE CASCADE,
        occurrence_key TEXT NOT NULL,
        scheduled_at INTEGER NOT NULL CHECK(scheduled_at >= 0),
        delivered_at INTEGER CHECK(delivered_at IS NULL OR delivered_at >= 0),
        acted_at INTEGER CHECK(acted_at IS NULL OR acted_at >= 0),
        action TEXT CHECK(action IS NULL OR action IN ('complete', 'snooze', 'dismiss')),
        notification_id TEXT,
        UNIQUE(reminder_rule_id, occurrence_key, scheduled_at)
      );
      CREATE INDEX reminder_deliveries_scheduled
        ON reminder_deliveries(scheduled_at, delivered_at);
    `,
  },
  {
    version: 3,
    name: 'idempotency_layout_and_sync_protocol',
    sql: `
      CREATE TABLE command_receipts (
        command_id TEXT PRIMARY KEY NOT NULL,
        command_name TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        result_json TEXT NOT NULL CHECK(json_valid(result_json)),
        applied_at INTEGER NOT NULL CHECK(applied_at >= 0)
      );
      CREATE INDEX command_receipts_applied_at ON command_receipts(applied_at);

      CREATE TABLE device_clocks (
        device_id TEXT PRIMARY KEY NOT NULL,
        wall_time INTEGER NOT NULL CHECK(wall_time >= 0),
        counter INTEGER NOT NULL CHECK(counter >= 0),
        sequence INTEGER NOT NULL DEFAULT 0 CHECK(sequence >= 0),
        updated_at INTEGER NOT NULL CHECK(updated_at >= 0)
      );

      CREATE TABLE clocks (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        hlc TEXT NOT NULL,
        device_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
        PRIMARY KEY(entity_type, entity_id, field_name)
      ) WITHOUT ROWID;
      CREATE INDEX clocks_hlc ON clocks(hlc);

      CREATE TABLE tombstones (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        hlc TEXT NOT NULL,
        device_id TEXT NOT NULL,
        deleted_at INTEGER NOT NULL CHECK(deleted_at >= 0),
        acknowledged_at INTEGER CHECK(acknowledged_at IS NULL OR acknowledged_at >= deleted_at),
        PRIMARY KEY(entity_type, entity_id)
      ) WITHOUT ROWID;
      CREATE INDEX tombstones_pending ON tombstones(acknowledged_at, hlc);

      CREATE TABLE oplog (
        op_id TEXT PRIMARY KEY NOT NULL,
        command_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL,
        device_seq INTEGER NOT NULL CHECK(device_seq > 0),
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK(operation IN ('upsert', 'delete')),
        payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
        hlc TEXT NOT NULL,
        created_at INTEGER NOT NULL CHECK(created_at >= 0),
        uploaded_at INTEGER CHECK(uploaded_at IS NULL OR uploaded_at >= created_at),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
        last_error TEXT
      );
      CREATE INDEX oplog_pending ON oplog(uploaded_at, hlc, op_id);
      CREATE UNIQUE INDEX oplog_device_sequence ON oplog(device_id, device_seq);
      CREATE INDEX oplog_entity ON oplog(entity_type, entity_id, hlc);
      CREATE INDEX oplog_command_id ON oplog(command_id);

      CREATE TABLE sync_cursors (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        remote_name TEXT NOT NULL,
        pull_cursor TEXT,
        last_pulled_at INTEGER CHECK(last_pulled_at IS NULL OR last_pulled_at >= 0),
        last_pushed_at INTEGER CHECK(last_pushed_at IS NULL OR last_pushed_at >= 0),
        last_error TEXT,
        PRIMARY KEY(workspace_id, remote_name)
      ) WITHOUT ROWID;

      CREATE TABLE dashboard_layout (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        section_key TEXT NOT NULL DEFAULT 'default',
        sort_order REAL NOT NULL DEFAULT 0,
        hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0, 1)),
        updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
        PRIMARY KEY(workspace_id, item_id)
      ) WITHOUT ROWID;
      CREATE INDEX dashboard_layout_order
        ON dashboard_layout(workspace_id, hidden, section_key, sort_order);
    `,
  },
  {
    version: 4,
    name: 'durable_remote_apply_receipts',
    sql: `
      CREATE TABLE sync_applied_mutations (
        mutation_id TEXT PRIMARY KEY NOT NULL,
        device_id TEXT NOT NULL,
        device_seq INTEGER NOT NULL CHECK(device_seq > 0),
        hlc TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK(operation IN ('upsert', 'delete')),
        payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
        applied_at INTEGER NOT NULL CHECK(applied_at >= 0),
        UNIQUE(device_id, device_seq)
      );
      CREATE INDEX sync_applied_mutations_entity
        ON sync_applied_mutations(entity_type, entity_id, hlc);
      CREATE INDEX sync_applied_mutations_applied_at
        ON sync_applied_mutations(applied_at);

      CREATE TABLE sync_upload_chains (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        remote_name TEXT NOT NULL,
        device_id TEXT NOT NULL,
        last_seq INTEGER NOT NULL CHECK(last_seq >= 0),
        last_segment_hash TEXT,
        last_hlc TEXT,
        updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
        PRIMARY KEY(workspace_id, remote_name, device_id)
      ) WITHOUT ROWID;
    `,
  },
  {
    version: 5,
    name: 'global_active_timer',
    sql: `
      CREATE TABLE active_timer (
        workspace_id TEXT PRIMARY KEY NOT NULL
          REFERENCES workspaces(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        started_at INTEGER NOT NULL CHECK(started_at >= 0),
        running_since INTEGER CHECK(running_since IS NULL OR running_since >= started_at),
        elapsed_seconds INTEGER NOT NULL DEFAULT 0 CHECK(elapsed_seconds >= 0),
        created_at INTEGER NOT NULL CHECK(created_at >= 0),
        updated_at INTEGER NOT NULL CHECK(updated_at >= created_at)
      );
      CREATE INDEX active_timer_item_id ON active_timer(item_id);

      INSERT INTO active_timer
        (workspace_id, item_id, started_at, running_since, elapsed_seconds, created_at, updated_at)
      SELECT i.workspace_id, h.item_id, h.timer_started_at, h.timer_started_at, 0,
             h.timer_started_at, h.timer_started_at
        FROM habits h
        JOIN items i ON i.id = h.item_id
       WHERE h.timer_started_at IS NOT NULL
         AND i.archived_at IS NULL
         AND i.deleted_at IS NULL
         AND (SELECT COUNT(*)
                FROM habits active_habit
                JOIN items active_item ON active_item.id = active_habit.item_id
               WHERE active_habit.timer_started_at IS NOT NULL
                 AND active_item.archived_at IS NULL
                 AND active_item.deleted_at IS NULL) = 1
       LIMIT 1;

      UPDATE habits
         SET timer_started_at = NULL
       WHERE EXISTS (SELECT 1 FROM active_timer);
    `,
  },
  {
    version: 6,
    name: 'active_timer_daily_segments',
    sql: `
      CREATE TABLE active_timer_segments (
        workspace_id TEXT NOT NULL
          REFERENCES active_timer(workspace_id) ON DELETE CASCADE,
        local_date TEXT NOT NULL CHECK(length(local_date) = 10),
        elapsed_seconds INTEGER NOT NULL CHECK(elapsed_seconds > 0),
        PRIMARY KEY(workspace_id, local_date)
      ) WITHOUT ROWID;
    `,
  },
] as const;

export function validateMigrationPlan(
  plan: readonly Migration[] = migrations,
): void {
  let expectedVersion = 1;
  const names = new Set<string>();
  for (const migration of plan) {
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Migration versions must be contiguous. Expected ${expectedVersion}, got ${migration.version}.`,
      );
    }
    if (!migration.name.trim() || names.has(migration.name)) {
      throw new Error(
        `Migration names must be non-empty and unique: ${migration.name}`,
      );
    }
    if (!migration.sql.trim())
      throw new Error(`Migration ${migration.version} has no SQL.`);
    names.add(migration.name);
    expectedVersion += 1;
  }
}

type UserVersionRow = { user_version: number };

export async function configureDatabase(
  database: SQLiteDatabase,
): Promise<void> {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);

  const foreignKeys = await database.getFirstAsync<{ foreign_keys: number }>(
    'PRAGMA foreign_keys',
  );
  if (foreignKeys?.foreign_keys !== 1) {
    throw new Error('SQLite foreign-key enforcement could not be enabled.');
  }
}

export async function migrateDatabase(database: SQLiteDatabase): Promise<void> {
  validateMigrationPlan();
  await configureDatabase(database);

  const row = await database.getFirstAsync<UserVersionRow>(
    'PRAGMA user_version',
  );
  const currentVersion = row?.user_version ?? 0;
  if (currentVersion > DATABASE_VERSION) {
    throw new Error(
      `Database version ${currentVersion} is newer than supported version ${DATABASE_VERSION}.`,
    );
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;

    await withWriteTransaction(database, async (transaction) => {
      await transaction.execAsync(migration.sql);
      // Version comes from a static migration plan, not user input.
      await transaction.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
  }

  // PRAGMAs are connection-scoped. Reassert them after the migration series.
  await configureDatabase(database);
}
