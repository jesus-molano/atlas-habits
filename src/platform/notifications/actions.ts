import type { NotificationResponse } from 'expo-notifications';

import {
  createCompleteOccurrenceEnvelope,
  createSnoozeReminderEnvelope,
  type CommandEnvelope,
} from '../commands';

import { NOTIFICATION_ACTIONS } from './constants';
import { parseReminderNotificationData } from './reminder-data';

/** Pure translation shared by the foreground listener and TaskManager. */
export function notificationResponseToCommand(
  response: NotificationResponse,
  issuedAt: Date,
): CommandEnvelope | null {
  const data = parseReminderNotificationData(
    response.notification.request.content.data,
  );

  if (!data) {
    return null;
  }

  if (response.actionIdentifier === NOTIFICATION_ACTIONS.complete) {
    return createCompleteOccurrenceEnvelope({
      targetKind: data.targetKind,
      targetId: data.targetId,
      occurrenceId: data.occurrenceId,
      source: 'notification',
      issuedAt,
    });
  }

  if (response.actionIdentifier === NOTIFICATION_ACTIONS.snooze) {
    return createSnoozeReminderEnvelope({
      reminderId: data.reminderId,
      targetKind: data.targetKind,
      targetId: data.targetId,
      occurrenceId: data.occurrenceId,
      sourceNotificationId: response.notification.request.identifier,
      snoozeMinutes: data.snoozeMinutes,
      source: 'notification',
      issuedAt,
    });
  }

  return null;
}
