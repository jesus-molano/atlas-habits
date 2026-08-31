import { describe, expect, it } from 'vitest';

import { createOptionalSyncProvider } from './provider';

describe('optional Firebase provider', () => {
  it('stays local-only without evaluating Firebase or the native Google module', () => {
    const provider = createOptionalSyncProvider({
      status: 'not-configured',
      missingEnvironmentVariables: ['EXPO_PUBLIC_FIREBASE_API_KEY'],
    });

    expect(provider).toEqual({
      mode: 'local-only',
      providerId: null,
      reason: 'not-configured',
      missingEnvironmentVariables: ['EXPO_PUBLIC_FIREBASE_API_KEY'],
      auth: null,
      transport: null,
    });
  });
});
