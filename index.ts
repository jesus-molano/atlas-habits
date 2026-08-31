import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { atlasPlatformCommandGateway } from './src/application/platform-command-gateway';
import { createInvalidatingCommandGateway } from './src/application/runtime-events';
import { atlasWidgetDataSource } from './src/application/widget-data-source';
import {
  addForegroundNotificationActionListener,
  configureReminderCategoryAndChannelAsync,
  registerBackgroundNotificationTaskAsync,
  setBackgroundNotificationGateway,
} from './src/platform/notifications';
import {
  refreshAtlasWidgetsAsync,
  registerAtlasWidgetTaskHandler,
} from './src/widgets';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const runtimeCommandGateway = createInvalidatingCommandGateway(
  atlasPlatformCommandGateway,
  {
    afterDispatch: () =>
      refreshAtlasWidgetsAsync(atlasWidgetDataSource).catch(() => undefined),
  },
);

setBackgroundNotificationGateway(() => runtimeCommandGateway);
addForegroundNotificationActionListener(runtimeCommandGateway);

if (Platform.OS === 'android') {
  registerAtlasWidgetTaskHandler({
    commandGateway: runtimeCommandGateway,
    dataSource: atlasWidgetDataSource,
  });
  void configureReminderCategoryAndChannelAsync().catch(() => undefined);
  void registerBackgroundNotificationTaskAsync().catch(() => undefined);
}

// Expo Router must be registered after all module-scope headless handlers.
// eslint-disable-next-line import/first
import 'expo-router/entry';
