import { describe, expect, it } from 'vitest';

import { createEmptySnapshot } from './empty-snapshot';

describe('createEmptySnapshot', () => {
  it('creates a new local profile without example content or statistics', () => {
    expect(createEmptySnapshot()).toEqual({
      schemaVersion: 1,
      source: 'local_store',
      habits: [],
      tasks: [],
      routines: [],
      dashboardOrder: ['routines', 'habits', 'tasks'],
      history: [],
      habitHistory: {},
      sync: { status: 'local-only' },
    });
  });

  it('returns independent collections and preserves the current sync state', () => {
    const first = createEmptySnapshot({
      status: 'connected',
      accountEmail: 'test@example.com',
    });
    const second = createEmptySnapshot();

    expect(first.sync).toEqual({
      status: 'connected',
      accountEmail: 'test@example.com',
    });
    expect(first.habits).not.toBe(second.habits);
    expect(first.dashboardOrder).not.toBe(second.dashboardOrder);
  });
});
