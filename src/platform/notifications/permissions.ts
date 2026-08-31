import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { canScheduleExactAlarms, openSettings } from 'react-native-permissions';

import { configureReminderCategoryAndChannelAsync } from './setup';

export type ExactAlarmAccess =
  'granted' | 'denied' | 'not-applicable' | 'settings-opened';

export interface ReminderPermissionState {
  readonly notificationsGranted: boolean;
  readonly exactAlarmAccess: ExactAlarmAccess;
}

export class ExactAlarmAccessError extends Error {
  readonly code = 'EXACT_ALARM_ACCESS_REQUIRED';

  constructor() {
    super(
      'Exact alarm access is required. Open the Android Alarms & reminders settings first.',
    );
    this.name = 'ExactAlarmAccessError';
  }
}

export async function getExactAlarmAccessAsync(): Promise<ExactAlarmAccess> {
  if (Platform.OS !== 'android') {
    return 'not-applicable';
  }

  return (await canScheduleExactAlarms()) ? 'granted' : 'denied';
}

/**
 * Android exposes exact alarms as special app access, not a runtime permission.
 * The user must grant it in system settings.
 */
export async function requestExactAlarmAccessAsync(): Promise<ExactAlarmAccess> {
  const access = await getExactAlarmAccessAsync();

  if (access !== 'denied') {
    return access;
  }

  await openSettings('alarms');
  return 'settings-opened';
}

export async function assertExactAlarmAccessAsync(): Promise<void> {
  if ((await getExactAlarmAccessAsync()) === 'denied') {
    throw new ExactAlarmAccessError();
  }
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
    exactAlarmAccess: await requestExactAlarmAccessAsync(),
  };
}
