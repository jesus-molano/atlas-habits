/// <reference types="node" />

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrateDatabase } from '../data/migrations';

import { rescheduleAtlasRemindersAsync } from './reminder-scheduler';

vi.mock('../platform/notifications', () => ({
  cancelOneShotReminderAsync: vi.fn(),
  getScheduledNotificationIdsAsync: vi.fn(),
  scheduleOneShotReminderAsync: vi.fn(),
}));

class AsyncTestDatabase {
  readonly native = new DatabaseSync(':memory:');

  async execAsync(source: string): Promise<void> {
    this.native.exec(source);
  }

  async getFirstAsync<T>(
    source: string,
    params: SQLInputValue[] = [],
  ): Promise<T | null> {
    return (
      (this.native.prepare(source).get(...params) as T | undefined) ?? null
    );
  }

  async getAllAsync<T>(
    source: string,
    params: SQLInputValue[] = [],
  ): Promise<T[]> {
    return this.native.prepare(source).all(...params) as T[];
  }

  async runAsync(
    source: string,
    params: SQLInputValue[] = [],
  ): Promise<SQLiteRunResult> {
    const result = this.native.prepare(source).run(...params);
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.native.exec('BEGIN');
    try {
      await task();
      this.native.exec('COMMIT');
    } catch (error) {
      this.native.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.native.close();
  }
}

describe('rescheduleAtlasRemindersAsync', () => {
  const opened: AsyncTestDatabase[] = [];

  afterEach(() => {
    for (const database of opened.splice(0)) database.close();
  });

  it('removes remaining current-period alarms as soon as a quota is reached', async () => {
    const adapter = new AsyncTestDatabase();
    opened.push(adapter);
    const database = adapter as unknown as SQLiteDatabase;
    await migrateDatabase(database);
    const createdAt = new Date(2026, 7, 1, 8, 0).getTime();
    await database.runAsync(
      `INSERT INTO items
        (id, workspace_id, type, title, sort_order, created_at, updated_at)
       VALUES ('habit-1', 'local-personal', 'habit', 'Moverse', 0, ?, ?)`,
      [createdAt, createdAt],
    );
    await database.runAsync(
      `INSERT INTO habits (item_id, measurement_type, unit, default_value)
       VALUES ('habit-1', 'boolean', 'vez', 1)`,
    );
    await database.runAsync(
      `INSERT INTO schedules (id, item_id, timezone, created_at)
       VALUES ('schedule-1', 'habit-1', 'Europe/Madrid', ?)`,
      [createdAt],
    );
    await database.runAsync(
      `INSERT INTO schedule_versions
        (id, schedule_id, version_number, effective_from, rule_type,
         rule_json, grace_minutes, created_at)
       VALUES
        ('version-1', 'schedule-1', 1, '2026-08-01', 'period_quota',
         '{"period":"week","quota":3,"weekStartsOn":1}', 0, ?)`,
      [createdAt],
    );
    await database.runAsync(
      `INSERT INTO schedule_goals
        (id, schedule_version_id, measurement_type, aggregation,
         comparison, target_value, unit)
       VALUES
        ('goal-1', 'version-1', 'boolean', 'count', 'at_least', 3, 'vez')`,
    );
    await database.runAsync(
      `INSERT INTO reminder_rules
        (id, item_id, enabled, local_time, snooze_minutes, created_at, updated_at)
       VALUES
        ('reminder-1', 'habit-1', 1, '09:00', 10, ?, ?)`,
      [createdAt, createdAt],
    );
    await database.runAsync(
      `INSERT INTO reminder_deliveries
        (id, reminder_rule_id, occurrence_key, scheduled_at, notification_id)
       VALUES
        ('delivery-snoozed', 'reminder-1', 'snoozed-occurrence', ?,
         'atlas-snooze-must-survive')`,
      [createdAt],
    );
    const cancelled: string[] = [];
    const scheduledEntries: {
      notificationId?: string;
      exactAlarm?: boolean;
    }[] = [];
    const scheduledIds = new Set(['atlas-snooze-must-survive']);
    let nextId = 0;
    const dependencies = {
      listScheduledNotificationIds: async () => [...scheduledIds],
      cancelOneShot: async (notificationId: string) => {
        cancelled.push(notificationId);
        scheduledIds.delete(notificationId);
      },
      scheduleOneShot: async (entry: {
        notificationId?: string;
        exactAlarm?: boolean;
      }) => {
        scheduledEntries.push(entry);
        const notificationId = entry.notificationId ?? 'unexpected-random-id';
        scheduledIds.add(notificationId);
        return notificationId;
      },
      createId: () => `new-delivery-${nextId++}`,
    };
    const options = {
      database,
      now: new Date(2026, 8, 2, 7, 0),
      horizonDays: 7,
      dependencies,
    } as const;

    expect(await rescheduleAtlasRemindersAsync(options)).toEqual({
      desired: 8,
      scheduled: 8,
      cancelled: 0,
    });
    expect(scheduledEntries.every((entry) => entry.exactAlarm === false)).toBe(
      true,
    );
    const currentPeriodIds = new Set(
      (
        await database.getAllAsync<{ notification_id: string }>(
          `SELECT notification_id FROM reminder_deliveries
            WHERE scheduled_at < ?
              AND notification_id LIKE 'atlas-reminder-%'
            ORDER BY scheduled_at`,
          [new Date(2026, 8, 7, 0, 0).getTime()],
        )
      ).map((row) => row.notification_id),
    );
    expect(currentPeriodIds.size).toBe(5);

    for (let revision = 0; revision < 3; revision += 1) {
      await database.runAsync(
        `INSERT INTO measurements
          (id, item_id, occurrence_key, session_id, schedule_version_id,
           value, operation, unit, occurred_at, local_date, source,
           created_at, updated_at)
         VALUES (?, 'habit-1', ?, ?, 'version-1', 1, 'add', 'vez', ?,
                 '2026-09-02', 'widget', ?, ?)`,
        [
          `measurement-${revision}`,
          `atlas:v1:habit:habit-1:quota:widget:${revision}:2026-09-02`,
          `session-${revision}`,
          createdAt + revision,
          createdAt + revision,
          createdAt + revision,
        ],
      );
      const result = await rescheduleAtlasRemindersAsync(options);
      expect(result).toEqual(
        revision < 2
          ? { desired: 8, scheduled: 0, cancelled: 0 }
          : { desired: 3, scheduled: 0, cancelled: 5 },
      );
    }

    expect(new Set(cancelled)).toEqual(currentPeriodIds);
    expect(scheduledIds.has('atlas-snooze-must-survive')).toBe(true);
    expect(
      adapter.native
        .prepare('SELECT COUNT(*) AS count FROM reminder_deliveries')
        .get(),
    ).toEqual({ count: 4 });

    await expect(
      rescheduleAtlasRemindersAsync({
        ...options,
        dependencies: {
          ...dependencies,
          cancelOneShot: async () => {
            throw new Error('native cancellation failed');
          },
        },
        enabled: false,
      }),
    ).rejects.toThrow('native cancellation failed');
    expect(
      adapter.native
        .prepare('SELECT COUNT(*) AS count FROM reminder_deliveries')
        .get(),
    ).toEqual({ count: 4 });

    expect(
      await rescheduleAtlasRemindersAsync({ ...options, enabled: false }),
    ).toEqual({ desired: 0, scheduled: 0, cancelled: 4 });
    expect(scheduledIds).toEqual(new Set());
    expect(
      adapter.native
        .prepare('SELECT COUNT(*) AS count FROM reminder_deliveries')
        .get(),
    ).toEqual({ count: 0 });
  });
});
