import { describe, expect, it, vi } from 'vitest';

import {
  readSnapshotForProvider,
  SnapshotApplyGuard,
} from './atlas-provider-runtime';
import type { AtlasAppAdapter, AtlasSnapshot } from './types';

function snapshot(source: AtlasSnapshot['source']): AtlasSnapshot {
  return {
    schemaVersion: 1,
    source,
    habits: [],
    tasks: [],
    routines: [],
    dashboardOrder: [],
    history: [],
    habitHistory: {},
    sync: { status: 'local-only' },
  };
}

function adapter(overrides: Partial<AtlasAppAdapter> = {}): AtlasAppAdapter {
  return {
    loadSnapshot: vi.fn(async () => snapshot('local_store')),
    refreshSnapshot: vi.fn(async () => snapshot('external_service')),
    saveSnapshot: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('SnapshotApplyGuard', () => {
  it('rejects a canonical read started before a newer optimistic mutation', () => {
    const guard = new SnapshotApplyGuard();
    const staleRequest = guard.beginRequest();

    guard.markOptimisticMutation();

    expect(guard.canApply(staleRequest)).toBe(false);
    expect(guard.canApply(guard.beginRequest())).toBe(true);
  });

  it('keeps latest-request-wins semantics for overlapping canonical reads', () => {
    const guard = new SnapshotApplyGuard();
    const olderRequest = guard.beginRequest();
    const newerRequest = guard.beginRequest();

    expect(guard.canApply(olderRequest)).toBe(false);
    expect(guard.canApply(newerRequest)).toBe(true);
  });

  it('invalidates pending reads during provider cleanup', () => {
    const guard = new SnapshotApplyGuard();
    const pendingRequest = guard.beginRequest();

    guard.cancelPendingRequests();

    expect(guard.canApply(pendingRequest)).toBe(false);
  });
});

describe('readSnapshotForProvider', () => {
  it('uses the pure refresh path for internal invalidations', async () => {
    const currentAdapter = adapter();

    const result = await readSnapshotForProvider(
      currentAdapter,
      'invalidation',
    );

    expect(result?.source).toBe('external_service');
    expect(currentAdapter.refreshSnapshot).toHaveBeenCalledOnce();
    expect(currentAdapter.loadSnapshot).not.toHaveBeenCalled();
  });

  it('uses the maintenance load path when AppState returns to active', async () => {
    const currentAdapter = adapter();

    const result = await readSnapshotForProvider(currentAdapter, 'maintenance');

    expect(result?.source).toBe('local_store');
    expect(currentAdapter.loadSnapshot).toHaveBeenCalledOnce();
    expect(currentAdapter.refreshSnapshot).not.toHaveBeenCalled();
  });

  it('does not fall back to maintenance when pure refresh is unavailable', async () => {
    const currentAdapter = adapter({ refreshSnapshot: undefined });

    await expect(
      readSnapshotForProvider(currentAdapter, 'invalidation'),
    ).resolves.toBeNull();
    expect(currentAdapter.loadSnapshot).not.toHaveBeenCalled();
  });
});
