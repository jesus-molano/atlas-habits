import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type InstallPermissionStatus = 'denied' | 'granted';

export interface AtlasInstallSession {
  readonly sessionId: number;
  readonly sha256: string;
  readonly status: 'session_committed';
  readonly versionCode: number;
  readonly versionName: string | null;
}

export type AtlasInstallFinalStatus =
  | 'awaiting_user_confirmation'
  | 'blocked'
  | 'cancelled'
  | 'conflict'
  | 'failed'
  | 'incompatible'
  | 'invalid'
  | 'storage_error'
  | 'success'
  | 'timeout';

export interface AtlasInstallStatus {
  readonly message: string | null;
  readonly sessionId: number;
  readonly status: AtlasInstallFinalStatus;
  readonly statusCode: number;
  readonly updatedAt: number;
}

interface AtlasUpdaterNativeModule {
  clearLastInstallStatusAsync(): Promise<void>;
  downloadAndInstallAsync(
    apkUrl: string,
    expectedSha256: string,
  ): Promise<AtlasInstallSession>;
  getInstallPermissionStatusAsync(): Promise<InstallPermissionStatus>;
  getLastInstallStatusAsync(): Promise<AtlasInstallStatus | null>;
  openInstallPermissionSettingsAsync(): Promise<void>;
}

const nativeUpdater =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<AtlasUpdaterNativeModule>('AtlasUpdater')
    : null;

export function isNativeUpdaterAvailable(): boolean {
  return nativeUpdater !== null;
}

export async function getInstallPermissionStatusAsync(): Promise<InstallPermissionStatus> {
  return requireUpdater().getInstallPermissionStatusAsync();
}

export async function openInstallPermissionSettingsAsync(): Promise<void> {
  return requireUpdater().openInstallPermissionSettingsAsync();
}

export async function downloadAndInstallAsync(
  apkUrl: string,
  expectedSha256: string,
): Promise<AtlasInstallSession> {
  return requireUpdater().downloadAndInstallAsync(apkUrl, expectedSha256);
}

export async function getLastInstallStatusAsync(): Promise<AtlasInstallStatus | null> {
  return requireUpdater().getLastInstallStatusAsync();
}

export async function clearLastInstallStatusAsync(): Promise<void> {
  return requireUpdater().clearLastInstallStatusAsync();
}

function requireUpdater(): AtlasUpdaterNativeModule {
  if (!nativeUpdater) {
    throw new Error(
      'El actualizador de Atlas solo está disponible en una compilación nativa para Android.',
    );
  }
  return nativeUpdater;
}
