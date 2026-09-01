import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isWidgetScheduleDueOnDate,
  SQLiteAtlasWidgetDataSource,
  widgetHabitOccurrenceId,
  type WidgetScheduleDefinition,
} from './widget-data-source';

const native = vi.hoisted(() => ({
  getCommandGateway: vi.fn(),
  loadAtlasSnapshotFromSQLite: vi.fn(),
}));

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: vi.fn(),
}));

vi.mock('../data', () => ({
  getCommandGateway: native.getCommandGateway,
  getDatabase: vi.fn(),
}));

vi.mock('./snapshot-loader', () => ({
  loadAtlasSnapshotFromSQLite: native.loadAtlasSnapshotFromSQLite,
}));

function definition(
  overrides: Partial<WidgetScheduleDefinition> = {},
): WidgetScheduleDefinition {
  return {
    itemId: 'habit-water',
    itemType: 'habit',
    title: 'Agua',
    priority: 0,
    dueAt: null,
    isPaused: false,
    scheduleVersionId: 'schedule-v1',
    versionNumber: 1,
    effectiveFrom: '2026-08-01',
    effectiveUntil: null,
    ruleType: 'daily',
    rule: {},
    measurementType: 'boolean',
    goalTarget: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('widget schedule projection', () => {
  it('supports weekday and interval schedules with civil dates', () => {
    const weekdays = definition({
      ruleType: 'weekdays',
      rule: { days: [1, 3, 5] },
    });
    expect(isWidgetScheduleDueOnDate(weekdays, '2026-08-31')).toBe(true);
    expect(isWidgetScheduleDueOnDate(weekdays, '2026-09-01')).toBe(false);

    const interval = definition({
      ruleType: 'interval',
      rule: { anchorDate: '2026-08-30', every: 3 },
    });
    expect(isWidgetScheduleDueOnDate(interval, '2026-09-02')).toBe(true);
    expect(isWidgetScheduleDueOnDate(interval, '2026-09-03')).toBe(false);
  });

  it('does not expose a one-off task before its configured due date', () => {
    const dueAt = new Date(2026, 8, 5, 18, 30).getTime();
    const task = definition({
      itemId: 'task-buy',
      itemType: 'task',
      dueAt,
      ruleType: 'once',
      rule: { date: '2026-08-31' },
    });
    expect(isWidgetScheduleDueOnDate(task, '2026-08-31')).toBe(false);
    expect(isWidgetScheduleDueOnDate(task, '2026-09-05')).toBe(true);
  });

  it('uses stable occurrence IDs and advances quota intent revisions', () => {
    expect(widgetHabitOccurrenceId('agua 2L', '2026-08-31')).toBe(
      'atlas:v1:habit:agua%202L:2026-08-31',
    );
    expect(widgetHabitOccurrenceId('agua 2L', '2026-08-31', 1)).toBe(
      'atlas:v1:habit:agua%202L:quota:widget:1:2026-08-31',
    );
    expect(widgetHabitOccurrenceId('agua 2L', '2026-08-31', 2)).not.toBe(
      widgetHabitOccurrenceId('agua 2L', '2026-08-31', 1),
    );
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function widgetDatabase(): SQLiteDatabase {
  return {
    getAllAsync: vi.fn().mockResolvedValue([]),
  } as unknown as SQLiteDatabase;
}

describe('SQLite widget snapshots', () => {
  it('shares one in-flight SQLite projection across concurrent widget instances', async () => {
    const pending = deferred<null>();
    native.getCommandGateway.mockResolvedValue({});
    native.loadAtlasSnapshotFromSQLite.mockReturnValueOnce(pending.promise);
    const source = new SQLiteAtlasWidgetDataSource(
      async () => widgetDatabase(),
      () => new Date('2026-09-01T09:00:00.000Z'),
    );

    const first = source.getSnapshot('AtlasProgressWidget');
    const second = source.getSnapshot('AtlasHabitsWidget');
    const third = source.getSnapshot('AtlasTasksWidget');

    await vi.waitFor(() => {
      expect(native.loadAtlasSnapshotFromSQLite).toHaveBeenCalledTimes(1);
    });
    pending.resolve(null);

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      expect.objectContaining({
        progress: expect.objectContaining({ completed: 0, total: 0 }),
      }),
      expect.objectContaining({
        progress: expect.objectContaining({ completed: 0, total: 0 }),
      }),
      expect.objectContaining({
        progress: expect.objectContaining({ completed: 0, total: 0 }),
      }),
    ]);
    expect(native.loadAtlasSnapshotFromSQLite).toHaveBeenCalledTimes(1);
  });

  it('retries a later widget refresh after a shared projection fails', async () => {
    native.getCommandGateway.mockResolvedValue({});
    native.loadAtlasSnapshotFromSQLite
      .mockRejectedValueOnce(new Error('SQLite unavailable'))
      .mockResolvedValueOnce(null);
    const source = new SQLiteAtlasWidgetDataSource(
      async () => widgetDatabase(),
      () => new Date('2026-09-01T09:00:00.000Z'),
    );

    await expect(source.getSnapshot('AtlasProgressWidget')).rejects.toThrow(
      'SQLite unavailable',
    );
    await expect(source.getSnapshot('AtlasProgressWidget')).resolves.toEqual(
      expect.objectContaining({
        progress: expect.objectContaining({ completed: 0, total: 0 }),
      }),
    );
    expect(native.loadAtlasSnapshotFromSQLite).toHaveBeenCalledTimes(2);
  });
});
