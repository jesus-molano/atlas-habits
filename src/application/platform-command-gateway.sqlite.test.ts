/// <reference types="node" />

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommandGateway } from '../data/command-gateway';
import { migrateDatabase } from '../data/migrations';
import { createCompleteOccurrenceEnvelope } from '../platform/commands';

import { SQLitePlatformCommandGateway } from './platform-command-gateway';

vi.mock('expo-application', () => ({ getAndroidId: () => 'test-device' }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('../platform/notifications', () => ({
  cancelOneShotReminderAsync: vi.fn(async () => undefined),
  getScheduledNotificationIdsAsync: vi.fn(async () => []),
  scheduleOneShotReminderAsync: vi.fn(async () => 'notification-id'),
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

describe('SQLitePlatformCommandGateway habit completion', () => {
  const opened: AsyncTestDatabase[] = [];

  afterEach(() => {
    for (const database of opened.splice(0)) database.close();
  });

  it('records one synced session per quota tap and ignores a cross-surface retry', async () => {
    const adapter = new AsyncTestDatabase();
    opened.push(adapter);
    const database = adapter as unknown as SQLiteDatabase;
    await migrateDatabase(database);
    const dataGateway = new CommandGateway(database);
    await dataGateway.items.createHabit({
      commandId: 'create-quota-habit',
      deviceId: 'test-device',
      issuedAt: new Date('2026-08-31T08:00:00Z').getTime(),
      payload: {
        id: 'habit-quota',
        title: 'Entrenar',
        measurementType: 'boolean',
        unit: 'vez',
        defaultValue: 1,
        schedule: {
          id: 'schedule-quota',
          timezone: 'Europe/Madrid',
          effectiveFrom: '2026-08-31',
          ruleType: 'period_quota',
          rule: { period: 'week', quota: 3, weekStartsOn: 1 },
          goals: [
            {
              id: 'goal-quota',
              measurementType: 'boolean',
              aggregation: 'sum',
              comparison: 'at_least',
              targetValue: 3,
              unit: 'vez',
            },
          ],
        },
      },
    });

    const rescheduleReminders = vi.fn(async () => ({
      desired: 0,
      scheduled: 0,
      cancelled: 0,
    }));
    const gateway = new SQLitePlatformCommandGateway({
      getDatabase: async () => database,
      getCommandGateway: async () => dataGateway,
      rescheduleReminders,
    });
    const completion = (
      revision: number,
      source: 'notification' | 'widget',
      hour = 9,
    ) =>
      createCompleteOccurrenceEnvelope({
        targetKind: 'habit',
        targetId: 'habit-quota',
        occurrenceId: `atlas:v1:habit:habit-quota:quota:widget:${revision}:2026-09-02`,
        source,
        issuedAt: new Date(
          `2026-09-02T${String(hour).padStart(2, '0')}:00:00Z`,
        ),
      });

    expect(await gateway.dispatch(completion(0, 'notification'))).toEqual({
      status: 'applied',
    });
    expect(await gateway.dispatch(completion(0, 'widget', 10))).toEqual({
      status: 'duplicate',
    });
    expect(await gateway.dispatch(completion(1, 'widget', 11))).toEqual({
      status: 'applied',
    });
    expect(await gateway.dispatch(completion(2, 'widget', 12))).toEqual({
      status: 'applied',
    });

    expect(
      adapter.native
        .prepare(
          `SELECT COUNT(*) AS count, SUM(value) AS value,
                  COUNT(DISTINCT session_id) AS sessions
             FROM measurements
            WHERE item_id = 'habit-quota' AND deleted_at IS NULL`,
        )
        .get(),
    ).toEqual({ count: 3, value: 3, sessions: 3 });
    expect(
      adapter.native
        .prepare(
          `SELECT COUNT(*) AS count, COUNT(DISTINCT entity_id) AS entities
             FROM oplog
            WHERE entity_type = 'measurement'`,
        )
        .get(),
    ).toEqual({ count: 3, entities: 3 });
    expect(rescheduleReminders).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['quantity', 5, 'km'],
    ['duration', 600, 'seconds'],
  ] as const)(
    'records the per-session %s goal instead of the period quota',
    async (measurementType, targetValue, unit) => {
      const adapter = new AsyncTestDatabase();
      opened.push(adapter);
      const database = adapter as unknown as SQLiteDatabase;
      await migrateDatabase(database);
      const dataGateway = new CommandGateway(database);
      await dataGateway.items.createHabit({
        commandId: `create-${measurementType}-habit`,
        deviceId: 'test-device',
        issuedAt: new Date('2026-08-31T08:00:00Z').getTime(),
        payload: {
          id: `habit-${measurementType}`,
          title: measurementType,
          measurementType,
          unit,
          defaultValue: 1,
          schedule: {
            timezone: 'Europe/Madrid',
            effectiveFrom: '2026-08-31',
            ruleType: 'period_quota',
            rule: { period: 'week', quota: 3, weekStartsOn: 1 },
            goals: [
              {
                measurementType,
                aggregation:
                  measurementType === 'duration' ? 'duration' : 'sum',
                comparison: 'at_least',
                targetValue,
                unit,
              },
            ],
          },
        },
      });
      const gateway = new SQLitePlatformCommandGateway({
        getDatabase: async () => database,
        getCommandGateway: async () => dataGateway,
        rescheduleReminders: async () => ({
          desired: 0,
          scheduled: 0,
          cancelled: 0,
        }),
      });

      await gateway.dispatch(
        createCompleteOccurrenceEnvelope({
          targetKind: 'habit',
          targetId: `habit-${measurementType}`,
          occurrenceId: `atlas:v1:habit:habit-${measurementType}:quota:widget:0:2026-09-02`,
          source: 'widget',
          issuedAt: new Date('2026-09-02T09:00:00Z'),
        }),
      );

      expect(
        adapter.native
          .prepare(
            `SELECT value, unit FROM measurements
              WHERE item_id = ? AND deleted_at IS NULL`,
          )
          .get(`habit-${measurementType}`),
      ).toEqual({ value: targetValue, unit });
    },
  );
});
