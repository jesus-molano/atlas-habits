import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandGateway as DataCommandGateway } from '../data';
import {
  createCompleteOccurrenceEnvelope,
  createSnoozeReminderEnvelope,
} from '../platform/commands';

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

const storage = vi.hoisted(() => ({
  getItem: vi.fn(async () => null as string | null),
}));

vi.mock('expo-application', () => ({ getAndroidId: () => 'test-device' }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: storage,
}));
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
    storage.getItem.mockResolvedValue(null);
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
    expect(rescheduleReminders).toHaveBeenCalledWith({
      database,
      enabled: true,
    });
  });

  it('does not re-enable alarms after completion when reminders are disabled', async () => {
    storage.getItem.mockResolvedValueOnce('false');
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
    const rescheduleReminders = vi.fn(async () => ({
      desired: 0,
      scheduled: 0,
      cancelled: 0,
    }));
    const gateway = new SQLitePlatformCommandGateway({
      getDatabase: async () => database,
      getCommandGateway: async () => ({}) as DataCommandGateway,
      rescheduleReminders,
    });

    await gateway.dispatch(
      createCompleteOccurrenceEnvelope({
        targetKind: 'habit',
        targetId: 'habit-1',
        occurrenceId: 'atlas:v1:habit:habit-1:2026-09-02',
        source: 'notification',
        issuedAt: new Date('2026-09-02T09:00:00.000Z'),
      }),
    );

    expect(rescheduleReminders).toHaveBeenCalledWith({
      database,
      enabled: false,
    });
  });

  it('keeps completion authoritative when the reminder preference cannot be read', async () => {
    storage.getItem.mockRejectedValueOnce(new Error('storage unavailable'));
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
    const rescheduleReminders = vi.fn(async () => ({
      desired: 0,
      scheduled: 0,
      cancelled: 0,
    }));
    const gateway = new SQLitePlatformCommandGateway({
      getDatabase: async () => database,
      getCommandGateway: async () => ({}) as DataCommandGateway,
      rescheduleReminders,
    });

    const result = await gateway.dispatch(
      createCompleteOccurrenceEnvelope({
        targetKind: 'habit',
        targetId: 'habit-1',
        occurrenceId: 'atlas:v1:habit:habit-1:2026-09-02',
        source: 'notification',
        issuedAt: new Date('2026-09-02T09:00:00.000Z'),
      }),
    );

    expect(result).toEqual({ status: 'applied' });
    expect(rescheduleReminders).toHaveBeenCalledWith({
      database,
      enabled: false,
    });
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

  it('does not persist a snooze until Android schedules it and can retry after a native failure', async () => {
    const nativeError = new Error('native schedule failed');
    native.schedule
      .mockRejectedValueOnce(nativeError)
      .mockResolvedValueOnce('atlas-snooze-recovered');
    const persist = vi.fn(async () => ({ changes: 1, lastInsertRowId: 1 }));
    const database = {
      getAllAsync: vi.fn(async () => []),
      getFirstAsync: vi.fn(async () => ({
        title: 'Beber agua',
        exact_alarm: 0,
      })),
      runAsync: persist,
    } as unknown as SQLiteDatabase;
    const gateway = new SQLitePlatformCommandGateway({
      getDatabase: async () => database,
      getCommandGateway: async () => ({}) as DataCommandGateway,
      rescheduleReminders: async () => ({
        desired: 0,
        scheduled: 0,
        cancelled: 0,
      }),
    });
    const envelope = createSnoozeReminderEnvelope({
      reminderId: 'reminder-1',
      targetKind: 'habit',
      targetId: 'habit-1',
      occurrenceId: 'atlas:v1:habit:habit-1:2026-09-02',
      sourceNotificationId: 'atlas-reminder-source',
      snoozeMinutes: 10,
      source: 'notification',
      issuedAt: new Date('2026-09-02T09:00:00.000Z'),
    });

    await expect(gateway.dispatch(envelope)).rejects.toBe(nativeError);
    expect(persist).not.toHaveBeenCalled();
    expect(data.recordMutation).not.toHaveBeenCalled();
    expect(native.cancel).not.toHaveBeenCalled();

    await expect(gateway.dispatch(envelope)).resolves.toEqual({
      status: 'applied',
    });
    expect(native.schedule).toHaveBeenLastCalledWith(
      expect.objectContaining({
        exactAlarm: false,
        notificationId: expect.stringMatching(/^atlas-snooze-/),
      }),
    );
    expect(persist).toHaveBeenCalledOnce();
    expect(data.recordMutation).toHaveBeenCalledOnce();
    expect(native.cancel).toHaveBeenCalledWith('atlas-reminder-source');
    expect(native.schedule.mock.invocationCallOrder[1]).toBeLessThan(
      persist.mock.invocationCallOrder[0]!,
    );
  });

  it('cancels a snooze if its local transaction cannot be committed', async () => {
    native.schedule.mockResolvedValueOnce('atlas-snooze-created');
    const writeError = new Error('SQLite write failed');
    const database = {
      getAllAsync: vi.fn(async () => []),
      getFirstAsync: vi.fn(async () => ({
        title: 'Beber agua',
        exact_alarm: 0,
      })),
      runAsync: vi.fn(async () => {
        throw writeError;
      }),
    } as unknown as SQLiteDatabase;
    const gateway = new SQLitePlatformCommandGateway({
      getDatabase: async () => database,
      getCommandGateway: async () => ({}) as DataCommandGateway,
      rescheduleReminders: async () => ({
        desired: 0,
        scheduled: 0,
        cancelled: 0,
      }),
    });

    await expect(
      gateway.dispatch(
        createSnoozeReminderEnvelope({
          reminderId: 'reminder-1',
          targetKind: 'habit',
          targetId: 'habit-1',
          occurrenceId: 'atlas:v1:habit:habit-1:2026-09-02',
          sourceNotificationId: 'atlas-reminder-source',
          snoozeMinutes: 10,
          source: 'notification',
          issuedAt: new Date('2026-09-02T09:00:00.000Z'),
        }),
      ),
    ).rejects.toBe(writeError);
    expect(native.cancel).toHaveBeenCalledOnce();
    expect(native.cancel).toHaveBeenCalledWith('atlas-snooze-created');
    expect(native.cancel).not.toHaveBeenCalledWith('atlas-reminder-source');
  });
});
