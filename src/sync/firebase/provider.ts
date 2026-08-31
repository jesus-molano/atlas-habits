import type { OptionalSyncProvider } from '../types';

import { FirebaseGoogleAuthAdapter } from './auth';
import {
  readFirebasePublicConfig,
  type FirebasePublicConfigResolution,
} from './config';
import { createFirebaseRuntimeLoader } from './runtime';
import { FirestoreSyncTransport } from './transport';

/**
 * Resolves synchronously to local-only when public Firebase config is absent.
 * Firebase and the native Google module are loaded only after a configured
 * adapter is actually used.
 */
export function createOptionalSyncProvider(
  resolution: FirebasePublicConfigResolution = readFirebasePublicConfig(),
): OptionalSyncProvider {
  if (resolution.status !== 'configured') {
    return {
      mode: 'local-only',
      providerId: null,
      reason: resolution.status,
      missingEnvironmentVariables: resolution.missingEnvironmentVariables,
      auth: null,
      transport: null,
    };
  }

  const getRuntime = createFirebaseRuntimeLoader(resolution.config);
  return {
    mode: 'remote',
    providerId: 'firebase',
    auth: new FirebaseGoogleAuthAdapter(getRuntime, resolution.config),
    transport: new FirestoreSyncTransport(
      getRuntime,
      resolution.config.expectedOwnerUid,
    ),
  };
}
