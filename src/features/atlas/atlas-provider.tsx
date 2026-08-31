import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';

import {
  readSnapshotForProvider,
  SnapshotApplyGuard,
  type ProviderSnapshotRead,
} from './atlas-provider-runtime';
import { createFallbackSnapshot } from './fallback-data';
import {
  createDefaultSchedule,
  expectedCompletions,
  firstReminderTime,
  isScheduledOnDate,
  normalizeSchedule,
  scheduleLabel,
} from './schedule';
import type {
  AdapterActionResult,
  AtlasAppAdapter,
  AtlasSnapshot,
  CreateItemDraft,
  DashboardSectionId,
  HabitDayRecord,
  HabitItem,
  RoutineItem,
} from './types';

const STORAGE_KEY = '@atlas/local-snapshot/v1';

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function todayKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function habitDone(habit: HabitItem): boolean {
  const target =
    habit.metric === 'boolean'
      ? expectedCompletions(habit.schedule)
      : habit.target;
  return habit.value >= target;
}

function habitsForDate(snapshot: AtlasSnapshot, date: string): HabitItem[] {
  const records = snapshot.habitHistory?.[date] ?? {};
  const scheduled = snapshot.habits.filter((habit) =>
    date === todayKey()
      ? isScheduledOnDate(habit.schedule, date)
      : (records[habit.id]?.scheduled ??
        isScheduledOnDate(habit.schedule, date)),
  );
  if (date === todayKey()) return scheduled;
  return scheduled.map((habit) => {
    const record = records[habit.id];
    return {
      ...habit,
      value: record?.value ?? 0,
      completed: record?.completed ?? false,
      skipped: record?.skipped ?? false,
      paused: record?.paused ?? false,
      timerStartedAt: undefined,
    };
  });
}

function isSnapshot(value: unknown): value is AtlasSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AtlasSnapshot>;
  return (
    candidate.schemaVersion === 1 &&
    Array.isArray(candidate.habits) &&
    Array.isArray(candidate.tasks) &&
    Array.isArray(candidate.routines) &&
    Array.isArray(candidate.dashboardOrder)
  );
}

function upgradeStoredSnapshot(snapshot: AtlasSnapshot): AtlasSnapshot {
  const startDate = todayKey();
  const upgrade = <
    T extends HabitItem | AtlasSnapshot['tasks'][number] | RoutineItem,
  >(
    item: T,
  ): T => {
    const legacy = item as T & {
      schedule?: T['schedule'];
      reminders?: T['reminders'];
    };
    const schedule =
      legacy.schedule ??
      (item.kind === 'task' && !item.recurring
        ? { kind: 'once' as const, date: startDate, startDate, slots: [] }
        : createDefaultSchedule(startDate));
    const reminders =
      legacy.reminders ??
      (item.reminderTime
        ? [
            {
              id: uid('reminder'),
              time: item.reminderTime,
              enabled: true,
              snoozeMinutes: 10,
            },
          ]
        : []);
    return {
      ...item,
      schedule,
      reminders,
      scheduleLabel: scheduleLabel(schedule),
      reminderTime: firstReminderTime(reminders),
    };
  };
  return {
    ...snapshot,
    habits: snapshot.habits.map(upgrade),
    tasks: snapshot.tasks.map(upgrade),
    routines: snapshot.routines.map(upgrade),
  };
}

/**
 * Functional local adapter used until the SQLite adapter is injected by the
 * app shell. Seed content is written once, then the store is fully editable.
 */
export function createAsyncStorageAtlasAdapter(): AtlasAppAdapter {
  const loadSnapshot = async (): Promise<AtlasSnapshot | null> => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSnapshot(parsed)
      ? upgradeStoredSnapshot({
          ...parsed,
          habitHistory: parsed.habitHistory ?? {},
          source: 'local_store',
        })
      : null;
  };

  return {
    loadSnapshot,
    refreshSnapshot: loadSnapshot,
    async saveSnapshot(snapshot) {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...snapshot, source: 'local_store' }),
      );
    },
  };
}

const defaultAdapter = createAsyncStorageAtlasAdapter();

export type AtlasAppContextValue = {
  snapshot: AtlasSnapshot;
  selectedDate: string;
  selectedHabits: HabitItem[];
  isToday: boolean;
  hydrated: boolean;
  progress: { completed: number; total: number; ratio: number };
  toggleHabit(id: string): void;
  setHabitValue(id: string, value: number): void;
  addHabitValue(id: string, amount: number): void;
  skipHabit(id: string, date?: string): void;
  pauseHabit(id: string, pauseUntil?: string): void;
  resumeHabit(id: string): void;
  setSelectedDate(date: string): void;
  startHabitTimer(id: string): void;
  stopHabitTimer(id: string): void;
  toggleTask(id: string): void;
  toggleSubtask(taskId: string, subtaskId: string): void;
  createItem(draft: CreateItemDraft): string;
  updateItem(id: string, draft: CreateItemDraft): void;
  deleteItem(id: string): void;
  moveDashboardSection(section: DashboardSectionId, direction: -1 | 1): void;
  startRoutine(id: string): void;
  setRoutineStep(id: string, stepId: string, completed: boolean): void;
  finishRoutine(id: string): void;
  resetRoutine(id: string): void;
  connectGoogle(): Promise<AdapterActionResult>;
  disconnectGoogle(): Promise<AdapterActionResult>;
  requestNotificationAccess(): Promise<AdapterActionResult>;
  requestExactAlarmAccess(): Promise<AdapterActionResult>;
  checkForUpdate(): Promise<AdapterActionResult>;
};

const AtlasAppContext = createContext<AtlasAppContextValue | null>(null);

function updateHistoryForDate(
  snapshot: AtlasSnapshot,
  date: string,
): AtlasSnapshot {
  const datedHabits = habitsForDate(snapshot, date);
  const activeHabits = datedHabits.filter(
    (habit) => !habit.skipped && !habit.paused,
  );
  const currentDay = date === todayKey();
  const scheduledTasks = snapshot.tasks.filter((item) =>
    isScheduledOnDate(item.schedule, date),
  );
  const scheduledRoutines = snapshot.routines.filter((item) =>
    isScheduledOnDate(item.schedule, date),
  );
  const total =
    activeHabits.length +
    (currentDay ? scheduledTasks.length + scheduledRoutines.length : 0);
  const completed =
    activeHabits.filter(habitDone).length +
    (currentDay
      ? scheduledTasks.filter((item) => item.completed).length +
        scheduledRoutines.filter((item) => item.completed).length
      : 0);
  const ratio = total === 0 ? 0 : completed / total;
  const existing = snapshot.history.findIndex((day) => day.date === date);
  const history = [...snapshot.history];
  if (existing >= 0) history[existing] = { date, ratio };
  else history.push({ date, ratio });
  return { ...snapshot, history };
}

function adapterUnavailable(capability: string): AdapterActionResult {
  return {
    ok: false,
    message: `${capability} aún no está configurado en este dispositivo.`,
  };
}

export type AtlasAppProviderProps = PropsWithChildren<{
  adapter?: AtlasAppAdapter;
}>;

export function AtlasAppProvider({
  adapter = defaultAdapter,
  children,
}: AtlasAppProviderProps) {
  const [snapshot, setSnapshot] = useState<AtlasSnapshot>(
    createFallbackSnapshot,
  );
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [hydrated, setHydrated] = useState(false);
  const adapterRef = useRef(adapter);
  const snapshotApplyGuardRef = useRef(new SnapshotApplyGuard());

  useEffect(() => {
    adapterRef.current = adapter;
    let mounted = true;
    const applyGuard = snapshotApplyGuardRef.current;

    const readAndApply = async (
      reason: ProviderSnapshotRead,
    ): Promise<void> => {
      const token = applyGuard.beginRequest();
      try {
        const stored = await readSnapshotForProvider(adapter, reason);
        if (!mounted || !stored || !applyGuard.canApply(token)) return;
        setSnapshot(stored);
      } catch {
        // Maintenance and invalidation reads are best effort. The current local
        // snapshot remains usable when a read or optional sync fails.
      }
    };

    const hydrate = async (): Promise<void> => {
      const token = applyGuard.beginRequest();
      try {
        const stored = await adapter.loadSnapshot();
        if (!mounted || !applyGuard.canApply(token)) return;
        const next = stored ?? createFallbackSnapshot();
        setSnapshot(next);
        if (!stored) await adapter.saveSnapshot(next);
      } catch {
        if (!mounted || !applyGuard.canApply(token)) return;
        setSnapshot(createFallbackSnapshot());
      } finally {
        if (mounted) setHydrated(true);
      }
    };

    void hydrate();

    const unsubscribeFromInvalidations =
      adapter.refreshSnapshot && adapter.subscribeToSnapshotInvalidations
        ? adapter.subscribeToSnapshotInvalidations(() => {
            void readAndApply('invalidation');
          })
        : undefined;
    const appStateSubscription = AppState.addEventListener(
      'change',
      (state) => {
        if (state === 'active') void readAndApply('maintenance');
      },
    );

    return () => {
      mounted = false;
      applyGuard.cancelPendingRequests();
      unsubscribeFromInvalidations?.();
      appStateSubscription.remove();
    };
  }, [adapter]);

  const persist = useCallback(
    (
      updater: (current: AtlasSnapshot) => AtlasSnapshot,
      historyDate = selectedDate,
    ) => {
      snapshotApplyGuardRef.current.markOptimisticMutation();
      setSnapshot((current) => {
        const next = updateHistoryForDate(updater(current), historyDate);
        if (hydrated) void adapterRef.current.saveSnapshot(next);
        return next;
      });
    },
    [hydrated, selectedDate],
  );

  const updateHabitForDate = useCallback(
    (id: string, date: string, update: (habit: HabitItem) => HabitItem) => {
      persist((current) => {
        if (date === todayKey()) {
          return {
            ...current,
            habits: current.habits.map((habit) =>
              habit.id === id ? update(habit) : habit,
            ),
          };
        }
        const original = current.habits.find((habit) => habit.id === id);
        if (!original) return current;
        const existing = current.habitHistory?.[date]?.[id];
        const base: HabitItem = {
          ...original,
          value: existing?.value ?? 0,
          completed: existing?.completed ?? false,
          skipped: existing?.skipped ?? false,
          paused: existing?.paused ?? false,
          timerStartedAt: undefined,
        };
        const changed = update(base);
        const record: HabitDayRecord = {
          value: changed.value,
          completed: changed.completed,
          skipped: changed.skipped,
          paused: changed.paused,
          scheduled:
            existing?.scheduled ?? isScheduledOnDate(original.schedule, date),
        };
        return {
          ...current,
          habitHistory: {
            ...(current.habitHistory ?? {}),
            [date]: {
              ...(current.habitHistory?.[date] ?? {}),
              [id]: record,
            },
          },
        };
      }, date);
    },
    [persist],
  );

  const updateSelectedHabit = useCallback(
    (id: string, update: (habit: HabitItem) => HabitItem) => {
      updateHabitForDate(id, selectedDate, update);
    },
    [selectedDate, updateHabitForDate],
  );

  const toggleHabit = useCallback(
    (id: string) => {
      updateSelectedHabit(id, (habit) => {
        const target =
          habit.metric === 'boolean'
            ? expectedCompletions(habit.schedule)
            : habit.target;
        const value =
          habit.value >= target ? 0 : Math.min(target, habit.value + 1);
        return {
          ...habit,
          completed: value >= target,
          skipped: false,
          value,
          timerStartedAt: undefined,
        };
      });
    },
    [updateSelectedHabit],
  );

  const setHabitValue = useCallback(
    (id: string, value: number) => {
      updateSelectedHabit(id, (habit) => {
        const safeValue = Math.max(0, value);
        return {
          ...habit,
          value: safeValue,
          completed: safeValue >= habit.target,
          skipped: false,
        };
      });
    },
    [updateSelectedHabit],
  );

  const addHabitValue = useCallback(
    (id: string, amount: number) => {
      updateSelectedHabit(id, (habit) => {
        const value = Math.max(0, habit.value + amount);
        return {
          ...habit,
          value,
          completed: value >= habit.target,
          skipped: false,
        };
      });
    },
    [updateSelectedHabit],
  );

  const skipHabit = useCallback(
    (id: string, date = selectedDate) => {
      updateHabitForDate(id, date, (habit) => ({
        ...habit,
        skipped: !habit.skipped,
        completed: false,
        timerStartedAt: undefined,
      }));
    },
    [selectedDate, updateHabitForDate],
  );

  const pauseHabit = useCallback(
    (id: string, pauseUntil?: string) => {
      persist((current) => ({
        ...current,
        habits: current.habits.map((habit) =>
          habit.id === id
            ? { ...habit, paused: true, pauseUntil, timerStartedAt: undefined }
            : habit,
        ),
      }));
    },
    [persist],
  );

  const resumeHabit = useCallback(
    (id: string) => {
      persist((current) => ({
        ...current,
        habits: current.habits.map((habit) =>
          habit.id === id
            ? { ...habit, paused: false, pauseUntil: undefined }
            : habit,
        ),
      }));
    },
    [persist],
  );

  const startHabitTimer = useCallback(
    (id: string) => {
      persist((current) => ({
        ...current,
        habits: current.habits.map((habit) =>
          habit.id === id ? { ...habit, timerStartedAt: Date.now() } : habit,
        ),
      }));
    },
    [persist],
  );

  const stopHabitTimer = useCallback(
    (id: string) => {
      persist((current) => ({
        ...current,
        habits: current.habits.map((habit) => {
          if (habit.id !== id || habit.timerStartedAt === undefined)
            return habit;
          const elapsed = Math.max(
            1,
            Math.round((Date.now() - habit.timerStartedAt) / 1_000),
          );
          const value = habit.value + elapsed;
          return {
            ...habit,
            value,
            completed: value >= habit.target,
            timerStartedAt: undefined,
          };
        }),
      }));
    },
    [persist],
  );

  const toggleTask = useCallback(
    (id: string) => {
      persist((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === id ? { ...task, completed: !task.completed } : task,
        ),
      }));
    },
    [persist],
  );

  const toggleSubtask = useCallback(
    (taskId: string, subtaskId: string) => {
      persist((current) => ({
        ...current,
        tasks: current.tasks.map((task) => {
          if (task.id !== taskId) return task;
          const subtasks = task.subtasks.map((subtask) =>
            subtask.id === subtaskId
              ? { ...subtask, completed: !subtask.completed }
              : subtask,
          );
          const required = subtasks.filter((subtask) => subtask.required);
          return {
            ...task,
            subtasks,
            completed:
              required.length > 0 &&
              required.every((subtask) => subtask.completed),
          };
        }),
      }));
    },
    [persist],
  );

  const createItem = useCallback(
    (draft: CreateItemDraft): string => {
      const id = uid(draft.kind);
      persist((current) => {
        const normalizedSchedule = normalizeSchedule(draft.schedule);
        const reminders = draft.reminders.map((reminder) => ({ ...reminder }));
        const common = {
          id,
          title: draft.title.trim(),
          notes: draft.notes?.trim() || undefined,
          category: draft.category?.trim() || undefined,
          tags: draft.tags ?? [],
          schedule: normalizedSchedule,
          reminders,
          scheduleLabel: scheduleLabel(normalizedSchedule),
          reminderTime: firstReminderTime(reminders),
          sortOrder:
            draft.kind === 'habit'
              ? current.habits.length
              : draft.kind === 'task'
                ? current.tasks.length
                : current.routines.length,
        };

        if (draft.kind === 'habit') {
          return {
            ...current,
            habits: [
              ...current.habits,
              {
                ...common,
                kind: 'habit',
                metric: draft.metric,
                target: Math.max(1, draft.target),
                unit: draft.unit,
                value: 0,
                completed: false,
                graceMinutes: draft.graceMinutes,
                streak: 0,
              },
            ],
          };
        }

        if (draft.kind === 'task') {
          return {
            ...current,
            tasks: [
              ...current.tasks,
              {
                ...common,
                kind: 'task',
                priority: draft.priority,
                dueAt: draft.dueAt,
                deadlineAt: draft.deadlineAt,
                recurring: draft.recurring,
                completed: false,
                subtasks: draft.subtasks
                  .filter((subtask) => subtask.title.trim())
                  .map((subtask) => ({
                    id: subtask.id ?? uid('subtask'),
                    title: subtask.title.trim(),
                    completed: false,
                    required: subtask.required,
                  })),
              },
            ],
          };
        }

        return {
          ...current,
          routines: [
            ...current.routines,
            {
              ...common,
              kind: 'routine',
              completed: false,
              running: false,
              steps: draft.steps
                .filter((step) => step.title.trim())
                .map((step) => ({
                  id: step.id ?? uid('step'),
                  title: step.title.trim(),
                  completed: false,
                  required: step.required,
                  durationSeconds: step.durationSeconds,
                })),
            },
          ],
        };
      });
      return id;
    },
    [persist],
  );

  const updateItem = useCallback(
    (id: string, draft: CreateItemDraft) => {
      persist((current) => {
        const normalizedSchedule = normalizeSchedule(draft.schedule);
        const reminders = draft.reminders.map((reminder) => ({ ...reminder }));
        const common = {
          title: draft.title.trim(),
          notes: draft.notes?.trim() || undefined,
          category: draft.category?.trim() || undefined,
          tags: draft.tags ?? [],
          schedule: normalizedSchedule,
          reminders,
          scheduleLabel: scheduleLabel(normalizedSchedule),
          reminderTime: firstReminderTime(reminders),
        };

        if (draft.kind === 'habit') {
          return {
            ...current,
            habits: current.habits.map((habit) =>
              habit.id === id
                ? {
                    ...habit,
                    ...common,
                    metric: draft.metric,
                    target: Math.max(1, draft.target),
                    unit: draft.unit,
                    graceMinutes: draft.graceMinutes,
                    completed:
                      draft.metric === 'boolean'
                        ? habit.completed
                        : habit.value >= Math.max(1, draft.target),
                  }
                : habit,
            ),
          };
        }

        if (draft.kind === 'task') {
          return {
            ...current,
            tasks: current.tasks.map((task) =>
              task.id === id
                ? {
                    ...task,
                    ...common,
                    priority: draft.priority,
                    dueAt: draft.dueAt,
                    deadlineAt: draft.deadlineAt,
                    recurring: draft.recurring,
                    subtasks: draft.subtasks
                      .filter((subtask) => subtask.title.trim())
                      .map((subtask, index) => ({
                        id:
                          subtask.id ??
                          task.subtasks[index]?.id ??
                          uid('subtask'),
                        title: subtask.title.trim(),
                        required: subtask.required,
                        completed: task.subtasks[index]?.completed ?? false,
                      })),
                  }
                : task,
            ),
          };
        }

        return {
          ...current,
          routines: current.routines.map((routine) =>
            routine.id === id
              ? {
                  ...routine,
                  ...common,
                  steps: draft.steps
                    .filter((step) => step.title.trim())
                    .map((step, index) => ({
                      id: step.id ?? routine.steps[index]?.id ?? uid('step'),
                      title: step.title.trim(),
                      required: step.required,
                      durationSeconds: step.durationSeconds,
                      completed: routine.steps[index]?.completed ?? false,
                    })),
                }
              : routine,
          ),
        };
      });
    },
    [persist],
  );

  const deleteItem = useCallback(
    (id: string) => {
      persist((current) => ({
        ...current,
        habits: current.habits.filter((item) => item.id !== id),
        tasks: current.tasks.filter((item) => item.id !== id),
        routines: current.routines.filter((item) => item.id !== id),
        habitHistory: Object.fromEntries(
          Object.entries(current.habitHistory).map(([date, records]) => [
            date,
            Object.fromEntries(
              Object.entries(records).filter(([habitId]) => habitId !== id),
            ),
          ]),
        ),
      }));
    },
    [persist],
  );

  const moveDashboardSection = useCallback(
    (section: DashboardSectionId, direction: -1 | 1) => {
      persist((current) => {
        const from = current.dashboardOrder.indexOf(section);
        const to = from + direction;
        if (from < 0 || to < 0 || to >= current.dashboardOrder.length)
          return current;
        const dashboardOrder = [...current.dashboardOrder];
        [dashboardOrder[from], dashboardOrder[to]] = [
          dashboardOrder[to] as DashboardSectionId,
          dashboardOrder[from] as DashboardSectionId,
        ];
        return { ...current, dashboardOrder };
      });
    },
    [persist],
  );

  const updateRoutine = useCallback(
    (id: string, update: (routine: RoutineItem) => RoutineItem) => {
      persist((current) => ({
        ...current,
        routines: current.routines.map((routine) =>
          routine.id === id ? update(routine) : routine,
        ),
      }));
    },
    [persist],
  );

  const startRoutine = useCallback(
    (id: string) =>
      updateRoutine(id, (routine) => ({ ...routine, running: true })),
    [updateRoutine],
  );

  const setRoutineStep = useCallback(
    (id: string, stepId: string, completed: boolean) => {
      updateRoutine(id, (routine) => ({
        ...routine,
        running: true,
        steps: routine.steps.map((step) =>
          step.id === stepId ? { ...step, completed } : step,
        ),
      }));
    },
    [updateRoutine],
  );

  const finishRoutine = useCallback(
    (id: string) =>
      updateRoutine(id, (routine) => ({
        ...routine,
        completed: routine.steps
          .filter((step) => step.required)
          .every((step) => step.completed),
        running: false,
      })),
    [updateRoutine],
  );

  const resetRoutine = useCallback(
    (id: string) =>
      updateRoutine(id, (routine) => ({
        ...routine,
        completed: false,
        running: false,
        steps: routine.steps.map((step) => ({ ...step, completed: false })),
      })),
    [updateRoutine],
  );

  const runAdapterAction = useCallback(
    async (
      action: keyof Pick<
        AtlasAppAdapter,
        | 'connectGoogle'
        | 'disconnectGoogle'
        | 'requestNotificationAccess'
        | 'requestExactAlarmAccess'
        | 'checkForUpdate'
      >,
      unavailableLabel: string,
    ): Promise<AdapterActionResult> => {
      const handler = adapterRef.current[action];
      if (!handler) return adapterUnavailable(unavailableLabel);
      return handler();
    },
    [],
  );

  const connectGoogle = useCallback(async () => {
    persist((current) => ({
      ...current,
      sync: { status: 'connecting' },
    }));
    const result = await runAdapterAction(
      'connectGoogle',
      'El acceso con Google',
    );
    persist((current) => ({
      ...current,
      sync: result.ok
        ? {
            status: 'connected',
            accountEmail: result.accountEmail,
            message: result.message,
          }
        : { status: 'error', message: result.message },
    }));
    return result;
  }, [persist, runAdapterAction]);

  const disconnectGoogle = useCallback(async () => {
    const result = await runAdapterAction('disconnectGoogle', 'La desconexión');
    if (result.ok) {
      persist((current) => ({ ...current, sync: { status: 'local-only' } }));
    }
    return result;
  }, [persist, runAdapterAction]);

  const progress = useMemo(() => {
    const selectedHabits = habitsForDate(snapshot, selectedDate);
    const activeHabits = selectedHabits.filter(
      (habit) => !habit.skipped && !habit.paused,
    );
    const isToday = selectedDate === todayKey();
    const scheduledTasks = snapshot.tasks.filter((item) =>
      isScheduledOnDate(item.schedule, selectedDate),
    );
    const scheduledRoutines = snapshot.routines.filter((item) =>
      isScheduledOnDate(item.schedule, selectedDate),
    );
    const total =
      activeHabits.length +
      (isToday ? scheduledTasks.length + scheduledRoutines.length : 0);
    const completed =
      activeHabits.filter(habitDone).length +
      (isToday
        ? scheduledTasks.filter((item) => item.completed).length +
          scheduledRoutines.filter((item) => item.completed).length
        : 0);
    return { completed, total, ratio: total === 0 ? 0 : completed / total };
  }, [selectedDate, snapshot]);

  const selectedHabits = useMemo(
    () => habitsForDate(snapshot, selectedDate),
    [selectedDate, snapshot],
  );

  const value = useMemo<AtlasAppContextValue>(
    () => ({
      snapshot,
      selectedDate,
      selectedHabits,
      isToday: selectedDate === todayKey(),
      hydrated,
      progress,
      toggleHabit,
      setHabitValue,
      addHabitValue,
      skipHabit,
      pauseHabit,
      resumeHabit,
      setSelectedDate,
      startHabitTimer,
      stopHabitTimer,
      toggleTask,
      toggleSubtask,
      createItem,
      updateItem,
      deleteItem,
      moveDashboardSection,
      startRoutine,
      setRoutineStep,
      finishRoutine,
      resetRoutine,
      connectGoogle,
      disconnectGoogle,
      requestNotificationAccess: () =>
        runAdapterAction('requestNotificationAccess', 'Los recordatorios'),
      requestExactAlarmAccess: () =>
        runAdapterAction('requestExactAlarmAccess', 'Las alarmas exactas'),
      checkForUpdate: () =>
        runAdapterAction('checkForUpdate', 'Las actualizaciones'),
    }),
    [
      addHabitValue,
      connectGoogle,
      createItem,
      deleteItem,
      disconnectGoogle,
      finishRoutine,
      hydrated,
      moveDashboardSection,
      progress,
      pauseHabit,
      resetRoutine,
      resumeHabit,
      runAdapterAction,
      setRoutineStep,
      setHabitValue,
      selectedDate,
      selectedHabits,
      skipHabit,
      snapshot,
      startHabitTimer,
      startRoutine,
      stopHabitTimer,
      toggleHabit,
      toggleSubtask,
      toggleTask,
      updateItem,
    ],
  );

  return (
    <AtlasAppContext.Provider value={value}>
      {children}
    </AtlasAppContext.Provider>
  );
}

export function useAtlasApp(): AtlasAppContextValue {
  const value = useContext(AtlasAppContext);
  if (!value)
    throw new Error('useAtlasApp debe usarse dentro de AtlasAppProvider.');
  return value;
}
