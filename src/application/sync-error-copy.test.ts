import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { SyncIntegrityError } from '../sync/errors';
import type { OptionalSyncProvider, SyncUser } from '../sync/types';

import { OptionalAtlasSync } from './optional-sync';
import {
  classifySyncFailure,
  googleAccessFailure,
  initialSyncFailure,
} from './sync-error-copy';

const user: SyncUser = {
  uid: 'owner',
  displayName: 'Atlas owner',
  email: 'owner@example.com',
  photoUrl: null,
};

function remoteProvider() {
  const auth = {
    providerId: 'test-google',
    getSession: vi.fn(async () => user),
    restoreSession: vi.fn(async () => user),
    signIn: vi.fn(async () => user),
    signOut: vi.fn(async () => undefined),
  };
  const provider: OptionalSyncProvider = {
    mode: 'remote',
    providerId: 'firebase',
    auth,
    transport: {
      providerId: 'test-firestore',
      uploadSegments: vi.fn(async () => ({ created: 0, alreadyPresent: 0 })),
      pull: vi.fn(async (cursor) => ({
        cursor,
        segments: [],
        hasMoreByDevice: {},
      })),
    },
  };
  return { auth, provider };
}

describe('sync error copy', () => {
  it.each([
    [{ code: 'SIGN_IN_CANCELLED' }, 'cancelled'],
    [{ code: 'auth/network-request-failed' }, 'network'],
    [{ code: 'auth/operation-not-allowed' }, 'google-provider-disabled'],
    [{ code: 'DEVELOPER_ERROR' }, 'credentials-configuration'],
    [{ code: 'firestore/permission-denied' }, 'firestore-permission'],
    [{ code: 'failed-precondition' }, 'firestore-setup'],
    [new SyncIntegrityError('raw internal detail'), 'remote-integrity'],
  ] as const)('classifies %p as %s', (error, expected) => {
    expect(classifySyncFailure(error)).toBe(expected);
  });

  it('never exposes the original technical sign-in error', () => {
    const result = googleAccessFailure(
      new Error('DEVELOPER_ERROR: oauth client 123 exploded'),
    );

    expect(result.kind).toBe('credentials-configuration');
    expect(result.message).toContain('configuración de Google');
    expect(result.message).not.toContain('123');
    expect(result.message).not.toContain('DEVELOPER_ERROR');
  });

  it('marks a Firestore rules rejection as permanent, not as queued', () => {
    const result = initialSyncFailure({
      code: 'firestore/permission-denied',
      message: 'Missing or insufficient permissions.',
    });

    expect(result.retryable).toBe(false);
    expect(result.message).toContain('reglas de seguridad');
    expect(result.message).not.toContain('pendiente');
  });
});

describe('OptionalAtlasSync connection failures', () => {
  it('returns a structured issue when session restoration fails', async () => {
    const { auth, provider } = remoteProvider();
    auth.restoreSession.mockRejectedValueOnce({
      code: 'auth/network-request-failed',
    });
    const sync = new OptionalAtlasSync(
      {} as SQLiteDatabase,
      'device-test',
      provider,
    );

    const state = await sync.state();

    expect(state).toMatchObject({
      status: 'error',
      issue: { kind: 'network', remediation: 'network' },
    });
    expect(state.message).toContain('conexión');
  });

  it('keeps a connection after an offline first sync so it can retry later', async () => {
    const { auth, provider } = remoteProvider();
    const sync = new OptionalAtlasSync(
      {} as SQLiteDatabase,
      'device-test',
      provider,
    );
    vi.spyOn(sync, 'syncNow').mockRejectedValue({
      code: 'firestore/unavailable',
    });

    const result = await sync.connect();

    expect(result).toMatchObject({
      ok: true,
      accountEmail: 'owner@example.com',
    });
    expect(result.message).toContain('pendientes');
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('rolls back sign-in when Firestore rules make sync impossible', async () => {
    const { auth, provider } = remoteProvider();
    const sync = new OptionalAtlasSync(
      {} as SQLiteDatabase,
      'device-test',
      provider,
    );
    vi.spyOn(sync, 'syncNow').mockRejectedValue({
      code: 'firestore/permission-denied',
      message: 'Missing or insufficient permissions. Secret debug detail.',
    });

    const result = await sync.connect();

    expect(result.ok).toBe(false);
    expect(result.message).toContain('reglas de seguridad');
    expect(result.message).not.toContain('Secret debug detail');
    expect(result.message).not.toContain('cola');
    expect(auth.signOut).toHaveBeenCalledOnce();
  });
});
