import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandGateway as DataCommandGateway } from '../data';
import { createCompleteOccurrenceEnvelope } from '../platform/commands';

import { SQLitePlatformCommandGateway } from './platform-command-gateway';

const native = vi.hoisted(() => ({
  cancel: vi.fn(async () => undefined),
  schedule: vi.fn(async () => 'notification-id'),
  list: vi.fn(async () => [] as string[]),
}));

const data = vi.hoisted(() => ({
  executeIdempotentCommand: vi.fn(
    async (
      database: unknown,
      _command: unknown,
      apply: (transaction: unknown) => Promise<unknown>,
    ) => ({ value: await apply(database), replayed: false }),
  ),
  recordMutation: vi.fn(async () => undefined),
}));

vi.mock('expo-application', () => ({ getAndroidId: () => 'test-device' }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('../data', () => ({
  createUuid: () => 'test-uuid',
  executeIdempotentCommand: data.executeIdempotentCommand,
  getCommandGateway: vi.fn(),
  getDatabase: vi.fn(),
  recordMutation: data.recordMutation,
}));
vi.mock('../platform/notifications', () => ({
  cancelOneShotReminderAsync: native.cancel,
  scheduleOneShotReminderAsync: native.schedule,
  getScheduledNotificationIdsAsync: native.list,
}));

describe('SQLitePlatformCommandGateway reminder maintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reconciles alarms after a committed platform completion and ignores maintenance errors', async () => {
    const database = {
      getAllAsync: vi.fn(async () => []),
      getFirstAsync: vi.fn(async (source: string) =>
        source.includes('FROM measurements') ||
        source.includes('FROM reminder_deliveries')
          ? null
          : {
              workspace_id: 'local-personal',
              measurement_type: 'boolean',
              unit: 'vez',
              default_value: 1,
              schedule_version_id: 'version-1',
              goal_target: 1,
              goal_unit: 'vez',
            },
      ),
      runAsync: vi.fn(async () => ({ changes: 1, lastInsertRowId: 1 })),
    } as unknown as SQLiteDatabase;
    const dataGateway = {} as DataCommandGateway;
    const maintenanceError = new Error('notification permission unavailable');
    const rescheduleReminders = vi.fn(async () => {
      throw maintenanceError;
    });
    const gateway = new SQLitePlatformCommandGateway({
      getDatabase: async () => database,
      getCommandGateway: async () => dataGateway,
      rescheduleReminders,
    });

    const result = await gateway.dispatch(
      createCompleteOccurrenceEnvelope({
        targetKind: 'habit',
        targetId: 'habit-1',
        occurrenceId: 'atlas:v1:habit:habit-1:quota:reminder-1:2026-09-02',
        source: 'notification',
        issuedAt: new Date('2026-09-02T09:00:00.000Z'),
      }),
    );

    expect(result).toEqual({ status: 'applied' });
    expect(database.runAsync).toHaveBeenCalledOnce();
    expect(data.recordMutation).toHaveBeenCalledOnce();
    expect(rescheduleReminders).toHaveBeenCalledWith({ database });
  });

  it('does not hide an authoritative write failure behind reminder maintenance', async () => {
    const writeError = new Error('SQLite write failed');
    const database = {
      getAllAsync: vi.fn(async () => []),
      getFirstAsync: vi.fn(async (source: string) =>
        source.includes('FROM measurements') ||
        source.includes('FROM reminder_deliveries')
          ? null
          : {
              workspace_id: 'local-personal',
              measurement_type: 'boolean',
              unit: 'vez',
              default_value: 1,
              schedule_version_id: 'version-1',
              goal_target: 1,
              goal_unit: 'vez',
            },
      ),
      runAsync: vi.fn(async () => {
        throw writeError;
      }),
    } as unknown as SQLiteDatabase;
    const dataGateway = {} as DataCommandGateway;
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

    await expect(
      gateway.dispatch(
        createCompleteOccurrenceEnvelope({
          targetKind: 'habit',
          targetId: 'habit-1',
          occurrenceId: 'atlas:v1:habit:habit-1:2026-09-02',
          source: 'widget',
          issuedAt: new Date('2026-09-02T09:00:00.000Z'),
        }),
      ),
    ).rejects.toBe(writeError);
    expect(rescheduleReminders).not.toHaveBeenCalled();
  });
});
