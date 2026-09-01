import type { ExpoConfig } from 'expo/config';

const googleServicesFile = process.env.ATLAS_GOOGLE_SERVICES_FILE;

const config: ExpoConfig = {
  name: 'Atlas',
  slug: 'atlas-habits',
  version: '0.1.3',
  orientation: 'portrait',
  icon: './assets/branding/icon.png',
  scheme: 'atlas',
  userInterfaceStyle: 'automatic',
  android: {
    allowBackup: false,
    softwareKeyboardLayoutMode: 'resize',
    package: 'atlas_habits.com',
    versionCode: 4,
    ...(googleServicesFile ? { googleServicesFile } : {}),
    adaptiveIcon: {
      backgroundColor: '#070A0F',
      foregroundImage: './assets/branding/icon-foreground.png',
      monochromeImage: './assets/branding/icon-monochrome.png',
    },
    predictiveBackGestureEnabled: true,
    permissions: [
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.INTERNET',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.REQUEST_INSTALL_PACKAGES',
    ],
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.SCHEDULE_EXACT_ALARM',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
  },
  web: {
    output: 'static',
    favicon: './assets/branding/favicon.png',
  },
  plugins: [
    'expo-router',
    ...(googleServicesFile
      ? ['@react-native-google-signin/google-signin']
      : []),
    './plugins/withAndroidReleaseSigning',
    [
      'expo-font',
      {
        fonts: [
          './node_modules/@expo-google-fonts/manrope/400Regular/Manrope_400Regular.ttf',
          './node_modules/@expo-google-fonts/manrope/500Medium/Manrope_500Medium.ttf',
          './node_modules/@expo-google-fonts/manrope/600SemiBold/Manrope_600SemiBold.ttf',
          './node_modules/@expo-google-fonts/manrope/700Bold/Manrope_700Bold.ttf',
        ],
      },
    ],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#070A0F',
        image: './assets/branding/splash-icon.png',
        imageWidth: 160,
      },
    ],
    [
      'expo-notifications',
      {
        color: '#FF6B5E',
        defaultChannel: 'atlas_reminders',
        icon: './assets/branding/notification-icon.png',
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          compileSdkVersion: 36,
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          minSdkVersion: 36,
          targetSdkVersion: 36,
          usesCleartextTraffic: false,
        },
      },
    ],
    [
      'react-native-android-widget',
      {
        fonts: [
          './node_modules/@expo-google-fonts/manrope/500Medium/Manrope_500Medium.ttf',
          './node_modules/@expo-google-fonts/manrope/700Bold/Manrope_700Bold.ttf',
        ],
        widgets: [
          {
            name: 'AtlasProgressWidget',
            label: 'Atlas · Progreso',
            description: 'Progreso de hábitos para hoy',
            minWidth: '180dp',
            minHeight: '48dp',
            targetCellWidth: 3,
            targetCellHeight: 1,
            resizeMode: 'horizontal|vertical',
          },
          {
            name: 'AtlasHabitsWidget',
            label: 'Atlas · Hábitos',
            description: 'Completa hábitos sin abrir Atlas',
            minWidth: '180dp',
            minHeight: '48dp',
            targetCellWidth: 3,
            targetCellHeight: 1,
            resizeMode: 'horizontal|vertical',
          },
          {
            name: 'AtlasTasksWidget',
            label: 'Atlas · Próximas tareas',
            description: 'Consulta las próximas tareas',
            minWidth: '180dp',
            minHeight: '48dp',
            targetCellWidth: 3,
            targetCellHeight: 1,
            resizeMode: 'horizontal|vertical',
          },
        ],
      },
    ],
  ],
  experiments: {
    reactCompiler: true,
    typedRoutes: true,
  },
};

export default config;
