import type { AtlasSnapshot } from '../features/atlas/types';

export const LEGACY_STARTER_ITEM_IDS = [
  'starter-water',
  'starter-read',
  'starter-vitamins',
  'starter-task-shopping',
  'starter-task-call',
  'starter-routine-morning',
] as const;

const LEGACY_STARTER_ITEM_ID_SET = new Set<string>(LEGACY_STARTER_ITEM_IDS);

function isLegacyStarterItem(id: string): boolean {
  return LEGACY_STARTER_ITEM_ID_SET.has(id);
}

/**
 * Removes only the fixed records shipped by v0.1.0. User-created records and
 * their history remain unchanged.
 */
export function withoutLegacyStarterItems(
  snapshot: AtlasSnapshot,
): AtlasSnapshot {
  const habits = snapshot.habits.filter(
    (item) => !isLegacyStarterItem(item.id),
  );
  const tasks = snapshot.tasks.filter((item) => !isLegacyStarterItem(item.id));
  const routines = snapshot.routines.filter(
    (item) => !isLegacyStarterItem(item.id),
  );
  const habitHistory = Object.fromEntries(
    Object.entries(snapshot.habitHistory).map(([date, records]) => [
      date,
      Object.fromEntries(
        Object.entries(records).filter(
          ([habitId]) => !isLegacyStarterItem(habitId),
        ),
      ),
    ]),
  );

  const itemsUnchanged =
    habits.length === snapshot.habits.length &&
    tasks.length === snapshot.tasks.length &&
    routines.length === snapshot.routines.length;
  const historyUnchanged = Object.values(snapshot.habitHistory).every(
    (records) =>
      Object.keys(records).every((habitId) => !isLegacyStarterItem(habitId)),
  );

  if (itemsUnchanged && historyUnchanged) return snapshot;
  return { ...snapshot, habits, tasks, routines, habitHistory };
}
