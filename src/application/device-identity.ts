import * as Application from 'expo-application';
import { Platform } from 'react-native';

/** Stable per signed APK, Android user and physical device. */
export function getAtlasDeviceId(): string {
  if (Platform.OS !== 'android') return 'atlas-local-development';
  try {
    const androidId = Application.getAndroidId().trim();
    return androidId ? `android-${androidId}` : 'android-atlas-unknown';
  } catch {
    return 'android-atlas-unknown';
  }
}
