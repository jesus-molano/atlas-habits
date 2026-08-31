import { describe, expect, it } from 'vitest';

import {
  createCompleteOccurrenceEnvelope,
  createSnoozeReminderEnvelope,
} from './commands';

describe('platform commands', () => {
  const issuedAt = new Date('2026-08-31T12:00:00.000Z');

  it('uses the same completion key across notification and widget retries', () => {
    const common = {
      targetKind: 'habit' as const,
      targetId: 'drink:water',
      occurrenceId: '2026-08-31',
      issuedAt,
    };

    const notification = createCompleteOccurrenceEnvelope({
      ...common,
      source: 'notification',
    });
    const widget = createCompleteOccurrenceEnvelope({
      ...common,
      source: 'widget',
    });

    expect(notification.idempotencyKey).toBe(widget.idempotencyKey);
    expect(notification.command.completed).toBe(true);
    expect(notification.idempotencyKey).not.toContain('drink:water');
  });

  it('builds a stable snooze command and deadline', () => {
    const command = createSnoozeReminderEnvelope({
      reminderId: 'reminder-1',
      targetKind: 'task',
      targetId: 'task-1',
      occurrenceId: 'occurrence-1',
      sourceNotificationId: 'notification-1',
      snoozeMinutes: 10,
      source: 'notification',
      issuedAt,
    });

    expect(command.command.snoozeUntil).toBe('2026-08-31T12:10:00.000Z');
    expect(command.idempotencyKey).toBe(
      'reminder.snooze:reminder-1:notification-1:10',
    );
  });

  it('rejects invalid snooze intervals', () => {
    expect(() =>
      createSnoozeReminderEnvelope({
        reminderId: 'reminder-1',
        targetKind: 'habit',
        targetId: 'habit-1',
        occurrenceId: 'occurrence-1',
        sourceNotificationId: 'notification-1',
        snoozeMinutes: 0,
        source: 'notification',
        issuedAt,
      }),
    ).toThrow(RangeError);
  });
});
