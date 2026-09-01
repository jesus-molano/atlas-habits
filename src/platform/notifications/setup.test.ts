import { describe, expect, it, vi } from 'vitest';

import {
  NOTIFICATION_ACTIONS,
  REMINDER_CATEGORY,
  ROUTINE_REMINDER_CATEGORY,
} from './constants';
import { configureReminderCategoryAndChannelAsync } from './setup';

const native = vi.hoisted(() => ({
  setNotificationCategoryAsync: vi.fn(async () => undefined),
  setNotificationChannelAsync: vi.fn(async () => undefined),
}));

vi.mock('expo-notifications', () => ({
  AndroidImportance: { MAX: 5 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  setNotificationCategoryAsync: native.setNotificationCategoryAsync,
  setNotificationChannelAsync: native.setNotificationChannelAsync,
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

describe('configureReminderCategoryAndChannelAsync', () => {
  it('no registra Completar para recordatorios de rutina', async () => {
    await configureReminderCategoryAndChannelAsync();

    expect(native.setNotificationCategoryAsync).toHaveBeenCalledWith(
      REMINDER_CATEGORY,
      expect.arrayContaining([
        expect.objectContaining({ identifier: NOTIFICATION_ACTIONS.complete }),
        expect.objectContaining({ identifier: NOTIFICATION_ACTIONS.snooze }),
      ]),
    );
    expect(native.setNotificationCategoryAsync).toHaveBeenCalledWith(
      ROUTINE_REMINDER_CATEGORY,
      [expect.objectContaining({ identifier: NOTIFICATION_ACTIONS.snooze })],
    );
  });
});
