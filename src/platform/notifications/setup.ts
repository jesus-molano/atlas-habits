import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  NOTIFICATION_ACTIONS,
  REMINDER_CATEGORY,
  REMINDER_CHANNEL,
} from './constants';

export async function configureReminderCategoryAndChannelAsync(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
      name: 'Recordatorios',
      description: 'Avisos de hábitos, tareas y rutinas',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 150, 250],
      enableVibrate: true,
      enableLights: true,
      lightColor: '#3C9FFE',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

  await Notifications.setNotificationCategoryAsync(REMINDER_CATEGORY, [
    {
      identifier: NOTIFICATION_ACTIONS.complete,
      buttonTitle: 'Completar',
      options: { opensAppToForeground: false },
    },
    {
      identifier: NOTIFICATION_ACTIONS.snooze,
      buttonTitle: 'Posponer',
      options: { opensAppToForeground: false },
    },
  ]);
}
