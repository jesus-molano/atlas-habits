import type { AtlasSnapshot, SyncState } from './types';

const DEFAULT_SYNC_STATE: SyncState = { status: 'local-only' };

/** Creates a fresh, production-safe profile with no example user data. */
export function createEmptySnapshot(
  sync: SyncState = DEFAULT_SYNC_STATE,
): AtlasSnapshot {
  return {
    schemaVersion: 1,
    source: 'local_store',
    habits: [],
    tasks: [],
    routines: [],
    dashboardOrder: ['routines', 'habits', 'tasks'],
    history: [],
    habitHistory: {},
    sync: { ...sync },
  };
}
