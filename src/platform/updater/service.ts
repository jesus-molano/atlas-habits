import * as Application from 'expo-application';

import {
  compareAtlasVersions,
  fetchLatestAtlasRelease,
  type AtlasGithubRelease,
  type FetchLatestAtlasReleaseOptions,
} from './github-release';
import {
  downloadAndInstallAsync,
  type AtlasInstallSession,
  type InstallPermissionStatus,
  getInstallPermissionStatusAsync,
  openInstallPermissionSettingsAsync,
} from './native';

export type AtlasUpdateCheck =
  | {
      readonly currentVersion: string;
      readonly latestVersion: string;
      readonly status: 'up_to_date';
    }
  | {
      readonly currentVersion: string;
      readonly release: AtlasGithubRelease;
      readonly status: 'available';
    };

export interface CheckForAtlasUpdateOptions extends FetchLatestAtlasReleaseOptions {
  readonly currentVersion?: string;
}

export async function checkForAtlasUpdateAsync(
  options: CheckForAtlasUpdateOptions = {},
): Promise<AtlasUpdateCheck> {
  const currentVersion =
    options.currentVersion ?? Application.nativeApplicationVersion ?? '0.0.0';
  const release = await fetchLatestAtlasRelease(options);
  if (compareAtlasVersions(release.version, currentVersion) <= 0) {
    return {
      currentVersion,
      latestVersion: release.version,
      status: 'up_to_date',
    };
  }

  return { currentVersion, release, status: 'available' };
}

export async function getAtlasInstallPermissionAsync(): Promise<InstallPermissionStatus> {
  return getInstallPermissionStatusAsync();
}

export async function requestAtlasInstallPermissionAsync(): Promise<void> {
  await openInstallPermissionSettingsAsync();
}

export async function installAtlasUpdateAsync(
  release: Pick<AtlasGithubRelease, 'apkUrl' | 'sha256'>,
): Promise<AtlasInstallSession> {
  return downloadAndInstallAsync(release.apkUrl, release.sha256);
}
