import * as Notifications from 'expo-notifications';

import { configureReminderCategoryAndChannelAsync } from './setup';

export interface ReminderPermissionState {
  readonly notificationsGranted: boolean;
}

export async function requestReminderPermissionsAsync(): Promise<ReminderPermissionState> {
  // Android 13+ does not show its notification prompt until a channel exists.
  await configureReminderCategoryAndChannelAsync();

  const existing = await Notifications.getPermissionsAsync();
  const permission =
    existing.status === Notifications.PermissionStatus.GRANTED
      ? existing
      : await Notifications.requestPermissionsAsync();

  return {
    notificationsGranted:
      permission.status === Notifications.PermissionStatus.GRANTED,
  };
}
