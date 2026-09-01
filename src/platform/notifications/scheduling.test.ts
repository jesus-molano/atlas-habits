import { describe, expect, it, vi } from 'vitest';

import { REMINDER_CATEGORY, ROUTINE_REMINDER_CATEGORY } from './constants';
import {
  reminderCategoryForTarget,
  scheduleOneShotReminderAsync,
} from './scheduling';

const native = vi.hoisted(() => ({
  scheduleNotificationAsync: vi.fn(async () => 'scheduled-reminder'),
}));

vi.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  scheduleNotificationAsync: native.scheduleNotificationAsync,
}));

describe('scheduleOneShotReminderAsync', () => {
  it('ignora la preferencia exacta heredada y programa sin permiso especial', async () => {
    await expect(
      scheduleOneShotReminderAsync(
        {
          reminderId: 'reminder-1',
          targetKind: 'habit',
          targetId: 'habit-1',
          occurrenceId: 'occurrence-1',
          title: 'Moverse',
          fireAt: new Date('2026-09-02T09:00:00.000Z'),
          exactAlarm: true,
        },
        new Date('2026-09-01T09:00:00.000Z'),
      ),
    ).resolves.toBe('scheduled-reminder');

    expect(native.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          categoryIdentifier: REMINDER_CATEGORY,
          data: expect.objectContaining({ atlasVersion: 1 }),
        }),
      }),
    );
  });

  it('usa una categoría sin Completar para una rutina y explica el toque', async () => {
    await scheduleOneShotReminderAsync(
      {
        reminderId: 'reminder-1',
        targetKind: 'routine-step',
        targetId: 'routine-1',
        occurrenceId: 'occurrence-1',
        title: 'Rutina de mañana',
        body: 'Toca completar o posponer',
        fireAt: new Date('2026-09-02T09:00:00.000Z'),
      },
      new Date('2026-09-01T09:00:00.000Z'),
    );

    expect(reminderCategoryForTarget('routine-step')).toBe(
      ROUTINE_REMINDER_CATEGORY,
    );
    expect(native.scheduleNotificationAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          body: 'Toca para abrir Atlas o posponer',
          categoryIdentifier: ROUTINE_REMINDER_CATEGORY,
        }),
      }),
    );
  });
});
