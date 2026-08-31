import type { NotificationResponse } from 'expo-notifications';
import { describe, expect, it } from 'vitest';

import { notificationResponseToCommand } from './actions';
import { NOTIFICATION_ACTIONS } from './constants';
import { createReminderNotificationData } from './reminder-data';

function response(actionIdentifier: string): NotificationResponse {
  return {
    actionIdentifier,
    notification: {
      date: Date.parse('2026-08-31T12:00:00.000Z'),
      request: {
        identifier: 'notification-1',
        trigger: { type: 'unknown' },
        content: {
          title: 'Caminar',
          subtitle: null,
          body: null,
          data: createReminderNotificationData({
            reminderId: 'reminder-1',
            targetKind: 'habit',
            targetId: 'habit-1',
            occurrenceId: 'occurrence-1',
            snoozeMinutes: 15,
          }),
          categoryIdentifier: 'ATLAS_REMINDER',
          sound: null,
        },
      },
    },
  };
}

describe('notification actions', () => {
  const now = new Date('2026-08-31T12:00:00.000Z');

  it('maps COMPLETE to an idempotent set-completed command', () => {
    const envelope = notificationResponseToCommand(
      response(NOTIFICATION_ACTIONS.complete),
      now,
    );

    expect(envelope?.command).toMatchObject({
      type: 'occurrence.complete',
      completed: true,
      targetId: 'habit-1',
    });
  });

  it('maps SNOOZE using the notification id as its retry token', () => {
    const envelope = notificationResponseToCommand(
      response(NOTIFICATION_ACTIONS.snooze),
      now,
    );

    expect(envelope).toMatchObject({
      idempotencyKey: 'reminder.snooze:reminder-1:notification-1:15',
      command: {
        type: 'reminder.snooze',
        snoozeUntil: '2026-08-31T12:15:00.000Z',
      },
    });
  });

  it('ignores the default notification tap', () => {
    expect(
      notificationResponseToCommand(
        response('expo.modules.notifications.actions.DEFAULT'),
        now,
      ),
    ).toBeNull();
  });
});
