import * as Notifications from 'expo-notifications';

import type { CommandTargetKind } from '../commands';

import {
  DEFAULT_SNOOZE_MINUTES,
  REMINDER_CATEGORY,
  REMINDER_CHANNEL,
} from './constants';
import { assertExactAlarmAccessAsync } from './permissions';
import { createReminderNotificationData } from './reminder-data';

export interface OneShotReminderInput {
  readonly notificationId?: string;
  readonly reminderId: string;
  readonly targetKind: CommandTargetKind;
  readonly targetId: string;
  readonly occurrenceId: string;
  readonly title: string;
  readonly body?: string;
  readonly fireAt: Date;
  readonly snoozeMinutes?: number;
  readonly exactAlarm?: boolean;
}

/**
 * Schedules one notification. Recurrence expansion belongs to the application
 * layer, which can create the next single-shot occurrence after this one fires.
 */
export async function scheduleOneShotReminderAsync(
  input: OneShotReminderInput,
  now: Date = new Date(),
): Promise<string> {
  if (input.fireAt.getTime() <= now.getTime()) {
    throw new RangeError('fireAt must be in the future.');
  }

  if (input.exactAlarm === true) await assertExactAlarmAccessAsync();

  return Notifications.scheduleNotificationAsync({
    identifier: input.notificationId,
    content: {
      title: input.title,
      body: input.body,
      categoryIdentifier: REMINDER_CATEGORY,
      sound: 'default',
      autoDismiss: true,
      data: createReminderNotificationData({
        reminderId: input.reminderId,
        targetKind: input.targetKind,
        targetId: input.targetId,
        occurrenceId: input.occurrenceId,
        snoozeMinutes: input.snoozeMinutes ?? DEFAULT_SNOOZE_MINUTES,
      }),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: input.fireAt,
      channelId: REMINDER_CHANNEL,
    },
  });
}

export async function cancelOneShotReminderAsync(
  notificationId: string,
): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}

/** Returns identifiers only; reconciliation remains in the application layer. */
export async function getScheduledNotificationIdsAsync(): Promise<string[]> {
  const requests = await Notifications.getAllScheduledNotificationsAsync();
  return requests.map((request) => request.identifier);
}
