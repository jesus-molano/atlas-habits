import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import type { CommandGateway } from '../commands';

import { notificationResponseToCommand } from './actions';
import { ATLAS_NOTIFICATION_TASK } from './constants';

type GatewayProvider = () => CommandGateway | null;

let gatewayProvider: GatewayProvider = () => null;

export function setBackgroundNotificationGateway(
  provider: GatewayProvider,
): void {
  gatewayProvider = provider;
}

export async function dispatchNotificationResponse(
  response: Notifications.NotificationResponse,
  gateway: CommandGateway,
  issuedAt: Date = new Date(),
): Promise<boolean> {
  const envelope = notificationResponseToCommand(response, issuedAt);

  if (!envelope) {
    return false;
  }

  await gateway.dispatch(envelope);
  return true;
}

if (!TaskManager.isTaskDefined(ATLAS_NOTIFICATION_TASK)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(
    ATLAS_NOTIFICATION_TASK,
    async ({ data, error }) => {
      if (error || !isNotificationResponse(data)) {
        return Notifications.BackgroundNotificationTaskResult.NoData;
      }

      const gateway = gatewayProvider();
      if (!gateway) {
        return Notifications.BackgroundNotificationTaskResult.Failed;
      }

      try {
        const dispatched = await dispatchNotificationResponse(data, gateway);
        return dispatched
          ? Notifications.BackgroundNotificationTaskResult.NewData
          : Notifications.BackgroundNotificationTaskResult.NoData;
      } catch {
        return Notifications.BackgroundNotificationTaskResult.Failed;
      }
    },
  );
}

export async function registerBackgroundNotificationTaskAsync(): Promise<void> {
  const registered = await TaskManager.isTaskRegisteredAsync(
    ATLAS_NOTIFICATION_TASK,
  );

  if (!registered) {
    await Notifications.registerTaskAsync(ATLAS_NOTIFICATION_TASK);
  }
}

export function addForegroundNotificationActionListener(
  gateway: CommandGateway,
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    void dispatchNotificationResponse(response, gateway).catch(() => {
      // The application gateway owns error reporting and retry persistence.
    });
  });
}

function isNotificationResponse(
  payload: Notifications.NotificationTaskPayload,
): payload is Notifications.NotificationResponse {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'actionIdentifier' in payload &&
    'notification' in payload
  );
}
