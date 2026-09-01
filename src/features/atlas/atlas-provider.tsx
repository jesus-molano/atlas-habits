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
  invokeOptionalAdapterAction,
  readSnapshotForProvider,
  SnapshotApplyGuard,
  type AtlasAdapterActionName,
  type ProviderSnapshotRead,
} from './atlas-provider-runtime';
import { createEmptySnapshot } from './empty-snapshot';
import { updateOptimisticHistoryForDate } from './optimistic-history';
import {
  createDefaultSchedule,
  expectedCompletions,
  firstReminderTime,
  isScheduledOnDate,
  normalizeSchedule,
  scheduleLabel,
} from './schedule';
import {
  toggleTaskCompletion,
  toggleTaskSubtaskCompletion,
} from './task-completion';
import type {
  AdapterActionResult,
  AtlasAppAdapter,
  AtlasDayMutation,
  AtlasDayView,
  AtlasSnapshot,
  CreateItemDraft,
  DashboardSectionId,
  HabitDayRecord,
  HabitItem,
  RoutineItem,
  TaskItem,
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

type HistoricalDayStatus =
  'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

type HistoricalDayState = Readonly<{
  date: string;
  status: HistoricalDayStatus;
  view: AtlasDayView | null;
  message?: string;
}>;

function withRecalculatedProgress(view: AtlasDayView): AtlasDayView {
  const activeHabits = view.habits.filter(
    (habit) => !habit.skipped && !habit.paused,
  );
  const total = activeHabits.length + view.tasks.length + view.routines.length;
  const completed =
    activeHabits.filter(habitDone).length +
    view.tasks.filter((task) => task.completed).length +
    view.routines.filter((routine) => routine.completed).length;
  return {
    ...view,
    progress: {
      completed,
      total,
      ratio: total === 0 ? 0 : completed / total,
    },
  };
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
    history: snapshot.history.map((day) => ({
      ...day,
      focusSeconds: day.focusSeconds ?? 0,
    })),
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
  selectedTasks: TaskItem[];
  selectedRoutines: RoutineItem[];
  isToday: boolean;
  hydrated: boolean;
  historicalDayStatus: HistoricalDayStatus;
  historicalDayMessage?: string;
  progress: { completed: number; total: number; ratio: number };
  toggleHabit(id: string): void;
  setHabitValue(id: string, value: number): void;
  addHabitValue(id: string, amount: number): void;
  skipHabit(id: string, date?: string): void;
  pauseHabit(id: string, pauseUntil?: string): void;
  resumeHabit(id: string): void;
  setSelectedDate(date: string): void;
  timerSheetOpen: boolean;
  openTimerSheet(itemId?: string): void;
  closeTimerSheet(): void;
  startTimer(itemId: string): Promise<AdapterActionResult>;
  pauseTimer(): Promise<AdapterActionResult>;
  resumeTimer(): Promise<AdapterActionResult>;
  stopTimer(localDate?: string): Promise<AdapterActionResult>;
  cancelTimer(): Promise<AdapterActionResult>;
  recordManualDuration(
    itemId: string,
    seconds: number,
    localDate?: string,
  ): Promise<AdapterActionResult>;
  resolveLegacyTimers(itemId: string | null): Promise<AdapterActionResult>;
  timerTargetId?: string;
  toggleTask(id: string, localDate?: string): void;
  toggleSubtask(taskId: string, subtaskId: string, localDate?: string): void;
  createItem(draft: CreateItemDraft): string;
  updateItem(id: string, draft: CreateItemDraft): void;
  deleteItem(id: string): void;
  moveDashboardSection(section: DashboardSectionId, direction: -1 | 1): void;
  startRoutine(id: string, localDate?: string): void;
  setRoutineStep(
    id: string,
    stepId: string,
    completed: boolean,
    localDate?: string,
  ): void;
  finishRoutine(id: string, localDate?: string): void;
  resetRoutine(id: string, localDate?: string): void;
  connectGoogle(): Promise<AdapterActionResult>;
  disconnectGoogle(): Promise<AdapterActionResult>;
  requestNotificationAccess(): Promise<AdapterActionResult>;
  requestExactAlarmAccess(): Promise<AdapterActionResult>;
  setRemindersEnabled(enabled: boolean): Promise<AdapterActionResult>;
  checkForUpdate(): Promise<AdapterActionResult>;
};

const AtlasAppContext = createContext<AtlasAppContextValue | null>(null);

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
  const [snapshot, setSnapshot] = useState<AtlasSnapshot>(createEmptySnapshot);
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [hydrated, setHydrated] = useState(false);
  const [timerSheetOpen, setTimerSheetOpen] = useState(false);
  const [timerTargetId, setTimerTargetId] = useState<string | undefined>();
  const [historicalDay, setHistoricalDay] = useState<HistoricalDayState>({
    date: '',
    status: 'idle',
    view: null,
  });
  const adapterRef = useRef(adapter);
  const snapshotApplyGuardRef = useRef(new SnapshotApplyGuard());
  const optimisticMutationGenerationRef = useRef(0);
  const adapterRefreshGenerationRef = useRef(0);
  const historicalDayRef = useRef(historicalDay);
  const historicalDayRequestGenerationRef = useRef(0);
  const historicalDayMutationGenerationRef = useRef(0);

  const commitHistoricalDay = useCallback((next: HistoricalDayState) => {
    historicalDayRef.current = next;
    setHistoricalDay(next);
  }, []);

  const requestHistoricalDay = useCallback(
    async (date: string, showLoading = true): Promise<void> => {
      const requestGeneration = ++historicalDayRequestGenerationRef.current;
      historicalDayMutationGenerationRef.current += 1;
      const loader = adapterRef.current.loadDay;
      const previous = historicalDayRef.current;
      if (!loader) {
        commitHistoricalDay({
          date,
          status: 'unavailable',
          view: null,
          message:
            'Este almacenamiento no conserva tareas ni rutinas por fecha.',
        });
        return;
      }
      if (showLoading) {
        commitHistoricalDay({
          date,
          status: 'loading',
          view: previous.date === date ? previous.view : null,
        });
      }
      try {
        const view = await loader.call(adapterRef.current, date);
        if (requestGeneration !== historicalDayRequestGenerationRef.current) {
          return;
        }
        commitHistoricalDay(
          view
            ? { date, status: 'ready', view }
            : {
                date,
                status: 'unavailable',
                view: null,
                message: 'No se pudo reconstruir el registro de esta fecha.',
              },
        );
      } catch {
        if (requestGeneration !== historicalDayRequestGenerationRef.current) {
          return;
        }
        commitHistoricalDay({
          date,
          status: 'error',
          view: previous.date === date ? previous.view : null,
          message:
            'No se pudo cargar esta fecha. Tus datos de Hoy no han cambiado.',
        });
      }
    },
    [commitHistoricalDay],
  );

  const applyHistoricalDayMutation = useCallback(
    (
      date: string,
      mutation: AtlasDayMutation,
      optimisticView: AtlasDayView,
    ): void => {
      const applyMutation = adapterRef.current.applyDayMutation;
      if (!applyMutation) {
        commitHistoricalDay({
          date,
          status: 'unavailable',
          view: historicalDayRef.current.view,
          message: 'Este almacenamiento no permite corregir días anteriores.',
        });
        return;
      }
      historicalDayRequestGenerationRef.current += 1;
      const mutationGeneration = ++historicalDayMutationGenerationRef.current;
      commitHistoricalDay({ date, status: 'ready', view: optimisticView });
      void applyMutation
        .call(adapterRef.current, date, mutation)
        .then((view) => {
          if (
            mutationGeneration !== historicalDayMutationGenerationRef.current
          ) {
            return;
          }
          commitHistoricalDay(
            view
              ? { date, status: 'ready', view }
              : {
                  date,
                  status: 'error',
                  view: optimisticView,
                  message: 'No se pudo confirmar el cambio de esta fecha.',
                },
          );
        })
        .catch(() => {
          if (
            mutationGeneration !== historicalDayMutationGenerationRef.current
          ) {
            return;
          }
          commitHistoricalDay({
            date,
            status: 'error',
            view: optimisticView,
            message:
              'No se pudo guardar el cambio. Vuelve a intentarlo antes de salir.',
          });
        });
    },
    [commitHistoricalDay],
  );

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
        const next = stored ?? createEmptySnapshot();
        setSnapshot(next);
        if (!stored) await adapter.saveSnapshot(next);
      } catch {
        if (!mounted || !applyGuard.canApply(token)) return;
        setSnapshot(createEmptySnapshot());
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

  useEffect(() => {
    if (!hydrated) return;
    if (selectedDate === todayKey()) {
      historicalDayRequestGenerationRef.current += 1;
      historicalDayMutationGenerationRef.current += 1;
      return;
    }
    void requestHistoricalDay(selectedDate);
    return () => {
      historicalDayRequestGenerationRef.current += 1;
    };
  }, [
    adapter,
    commitHistoricalDay,
    hydrated,
    requestHistoricalDay,
    selectedDate,
  ]);

  const persist = useCallback(
    (
      updater: (current: AtlasSnapshot) => AtlasSnapshot,
      historyDate = todayKey(),
    ) => {
      snapshotApplyGuardRef.current.markOptimisticMutation();
      optimisticMutationGenerationRef.current += 1;
      setSnapshot((current) => {
        const next = updateOptimisticHistoryForDate(
          updater(current),
          historyDate,
          todayKey(),
        );
        if (hydrated) void adapterRef.current.saveSnapshot(next, historyDate);
        return next;
      });
    },
    [hydrated],
  );

  const updateHabitForDate = useCallback(
    (id: string, date: string, update: (habit: HabitItem) => HabitItem) => {
      if (date !== todayKey()) {
        const historical = historicalDayRef.current;
        if (historical.date === date && historical.view) {
          const view = withRecalculatedProgress({
            ...historical.view,
            habits: historical.view.habits.map((habit) =>
              habit.id === id ? update(habit) : habit,
            ),
          });
          commitHistoricalDay({ date, status: 'ready', view });
        }
      }
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
    [commitHistoricalDay, persist],
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

  const refreshAfterAdapterMutation = useCallback(async () => {
    const refresh = adapterRef.current.refreshSnapshot;
    if (!refresh) return;
    const optimisticGeneration = optimisticMutationGenerationRef.current;
    const refreshGeneration = ++adapterRefreshGenerationRef.current;
    const stored = await refresh();
    if (
      stored &&
      optimisticGeneration === optimisticMutationGenerationRef.current &&
      refreshGeneration === adapterRefreshGenerationRef.current
    ) {
      snapshotApplyGuardRef.current.cancelPendingRequests();
      setSnapshot(stored);
    }
  }, []);

  const runTimerAction = useCallback(
    async (
      action:
        | 'startTimer'
        | 'pauseTimer'
        | 'resumeTimer'
        | 'stopTimer'
        | 'cancelTimer'
        | 'recordManualDuration'
        | 'resolveLegacyTimers',
      args: readonly unknown[] = [],
    ): Promise<AdapterActionResult> => {
      const method = adapterRef.current[action] as
        ((...values: never[]) => Promise<AdapterActionResult>) | undefined;
      if (!method) return adapterUnavailable('El cronómetro');
      const result = await method.apply(adapterRef.current, args as never[]);
      await refreshAfterAdapterMutation().catch(() => undefined);
      return result;
    },
    [refreshAfterAdapterMutation],
  );

  const openTimerSheet = useCallback((itemId?: string) => {
    setTimerTargetId(itemId);
    setTimerSheetOpen(true);
  }, []);

  const closeTimerSheet = useCallback(() => {
    setTimerSheetOpen(false);
    setTimerTargetId(undefined);
  }, []);

  const toggleTask = useCallback(
    (id: string, localDate = todayKey()) => {
      if (localDate === todayKey()) {
        persist(
          (current) => ({
            ...current,
            tasks: current.tasks.map((task) =>
              task.id === id ? toggleTaskCompletion(task) : task,
            ),
          }),
          localDate,
        );
        return;
      }

      const historical = historicalDayRef.current;
      const task = historical.view?.tasks.find((item) => item.id === id);
      if (historical.date !== localDate || !historical.view || !task) return;
      const nextTask = toggleTaskCompletion(task);
      const optimisticView = withRecalculatedProgress({
        ...historical.view,
        tasks: historical.view.tasks.map((item) =>
          item.id === id ? nextTask : item,
        ),
      });
      applyHistoricalDayMutation(
        localDate,
        {
          kind: 'task.update',
          taskId: id,
          completed: nextTask.completed,
          subtasks: nextTask.subtasks
            .filter(
              (subtask) =>
                task.subtasks.find((entry) => entry.id === subtask.id)
                  ?.completed !== subtask.completed,
            )
            .map((subtask) => ({
              id: subtask.id,
              completed: subtask.completed,
            })),
        },
        optimisticView,
      );
    },
    [applyHistoricalDayMutation, persist],
  );

  const toggleSubtask = useCallback(
    (taskId: string, subtaskId: string, localDate = todayKey()) => {
      if (localDate === todayKey()) {
        persist(
          (current) => ({
            ...current,
            tasks: current.tasks.map((task) => {
              if (task.id !== taskId) return task;
              return toggleTaskSubtaskCompletion(task, subtaskId);
            }),
          }),
          localDate,
        );
        return;
      }

      const historical = historicalDayRef.current;
      const task = historical.view?.tasks.find((item) => item.id === taskId);
      if (historical.date !== localDate || !historical.view || !task) return;
      const nextTask = toggleTaskSubtaskCompletion(task, subtaskId);
      if (nextTask === task) return;
      const changedSubtask = nextTask.subtasks.find(
        (subtask) => subtask.id === subtaskId,
      );
      if (!changedSubtask) return;
      const optimisticView = withRecalculatedProgress({
        ...historical.view,
        tasks: historical.view.tasks.map((item) =>
          item.id === taskId ? nextTask : item,
        ),
      });
      applyHistoricalDayMutation(
        localDate,
        {
          kind: 'task.update',
          taskId,
          completed: nextTask.completed,
          subtasks: [
            { id: changedSubtask.id, completed: changedSubtask.completed },
          ],
        },
        optimisticView,
      );
    },
    [applyHistoricalDayMutation, persist],
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
      persist(
        (current) => ({
          ...current,
          routines: current.routines.map((routine) =>
            routine.id === id ? update(routine) : routine,
          ),
        }),
        todayKey(),
      );
    },
    [persist],
  );

  const startRoutine = useCallback(
    (id: string, localDate = todayKey()) => {
      if (localDate === todayKey()) {
        updateRoutine(id, (routine) => ({ ...routine, running: true }));
        return;
      }
      const historical = historicalDayRef.current;
      const routine = historical.view?.routines.find((item) => item.id === id);
      if (
        historical.date !== localDate ||
        !historical.view ||
        !routine ||
        routine.running ||
        routine.completed
      ) {
        return;
      }
      const optimisticView = withRecalculatedProgress({
        ...historical.view,
        routines: historical.view.routines.map((item) =>
          item.id === id ? { ...item, running: true } : item,
        ),
      });
      applyHistoricalDayMutation(
        localDate,
        { kind: 'routine.start', routineId: id },
        optimisticView,
      );
    },
    [applyHistoricalDayMutation, updateRoutine],
  );

  const setRoutineStep = useCallback(
    (
      id: string,
      stepId: string,
      completed: boolean,
      localDate = todayKey(),
    ) => {
      if (localDate === todayKey()) {
        updateRoutine(id, (routine) => ({
          ...routine,
          running: true,
          steps: routine.steps.map((step) =>
            step.id === stepId ? { ...step, completed } : step,
          ),
        }));
        return;
      }
      const historical = historicalDayRef.current;
      const routine = historical.view?.routines.find((item) => item.id === id);
      const step = routine?.steps.find((item) => item.id === stepId);
      if (
        historical.date !== localDate ||
        !historical.view ||
        !routine ||
        !step ||
        step.completed === completed
      ) {
        return;
      }
      const optimisticView = withRecalculatedProgress({
        ...historical.view,
        routines: historical.view.routines.map((item) =>
          item.id === id
            ? {
                ...item,
                running: true,
                steps: item.steps.map((entry) =>
                  entry.id === stepId ? { ...entry, completed } : entry,
                ),
              }
            : item,
        ),
      });
      applyHistoricalDayMutation(
        localDate,
        { kind: 'routine.step', routineId: id, stepId, completed },
        optimisticView,
      );
    },
    [applyHistoricalDayMutation, updateRoutine],
  );

  const finishRoutine = useCallback(
    (id: string, localDate = todayKey()) => {
      if (localDate === todayKey()) {
        updateRoutine(id, (routine) => ({
          ...routine,
          completed: routine.steps
            .filter((step) => step.required)
            .every((step) => step.completed),
          running: false,
        }));
        return;
      }
      const historical = historicalDayRef.current;
      const routine = historical.view?.routines.find((item) => item.id === id);
      if (historical.date !== localDate || !historical.view || !routine) return;
      const completed = routine.steps
        .filter((step) => step.required)
        .every((step) => step.completed);
      const optimisticView = withRecalculatedProgress({
        ...historical.view,
        routines: historical.view.routines.map((item) =>
          item.id === id ? { ...item, completed, running: false } : item,
        ),
      });
      applyHistoricalDayMutation(
        localDate,
        { kind: 'routine.finish', routineId: id, completed },
        optimisticView,
      );
    },
    [applyHistoricalDayMutation, updateRoutine],
  );

  const resetRoutine = useCallback(
    (id: string, localDate = todayKey()) => {
      if (localDate === todayKey()) {
        updateRoutine(id, (routine) => ({
          ...routine,
          completed: false,
          running: false,
          steps: routine.steps.map((step) => ({ ...step, completed: false })),
        }));
        return;
      }
      const historical = historicalDayRef.current;
      const routine = historical.view?.routines.find((item) => item.id === id);
      if (historical.date !== localDate || !historical.view || !routine) return;
      const optimisticView = withRecalculatedProgress({
        ...historical.view,
        routines: historical.view.routines.map((item) =>
          item.id === id
            ? {
                ...item,
                completed: false,
                running: false,
                steps: item.steps.map((step) => ({
                  ...step,
                  completed: false,
                })),
              }
            : item,
        ),
      });
      applyHistoricalDayMutation(
        localDate,
        { kind: 'routine.reset', routineId: id },
        optimisticView,
      );
    },
    [applyHistoricalDayMutation, updateRoutine],
  );

  const runAdapterAction = useCallback(
    async (
      action: AtlasAdapterActionName,
      unavailableLabel: string,
    ): Promise<AdapterActionResult> => {
      return invokeOptionalAdapterAction(adapterRef.current, action, () =>
        adapterUnavailable(unavailableLabel),
      );
    },
    [],
  );

  const setSyncState = useCallback((sync: AtlasSnapshot['sync']) => {
    snapshotApplyGuardRef.current.markOptimisticMutation();
    optimisticMutationGenerationRef.current += 1;
    setSnapshot((current) => ({ ...current, sync }));
  }, []);

  const connectGoogle = useCallback(async () => {
    setSyncState({ status: 'connecting' });
    try {
      const result = await runAdapterAction(
        'connectGoogle',
        'El acceso con Google',
      );
      setSyncState(
        result.ok
          ? {
              status: 'connected',
              accountEmail: result.accountEmail,
              message: result.message,
              issue: result.syncIssue,
            }
          : {
              status: 'error',
              message: result.message,
              issue: result.syncIssue,
            },
      );
      return result;
    } catch {
      const result = {
        ok: false,
        message:
          'No se pudo iniciar sesión con Google. Tus datos siguen guardados en este dispositivo.',
      };
      setSyncState({ status: 'local-only', message: result.message });
      return result;
    }
  }, [runAdapterAction, setSyncState]);

  const disconnectGoogle = useCallback(async () => {
    const result = await runAdapterAction('disconnectGoogle', 'La desconexión');
    if (result.ok) {
      setSyncState({ status: 'local-only' });
    }
    return result;
  }, [runAdapterAction, setSyncState]);

  const viewingToday = selectedDate === todayKey();
  const selectedHistoricalView =
    !viewingToday && historicalDay.date === selectedDate
      ? historicalDay.view
      : null;
  const selectedHabits = useMemo(
    () =>
      selectedHistoricalView?.habits ?? habitsForDate(snapshot, selectedDate),
    [selectedDate, selectedHistoricalView, snapshot],
  );
  const selectedTasks = useMemo(
    () =>
      selectedHistoricalView?.tasks ??
      (viewingToday
        ? snapshot.tasks.filter((item) =>
            isScheduledOnDate(item.schedule, selectedDate),
          )
        : []),
    [selectedDate, selectedHistoricalView, snapshot.tasks, viewingToday],
  );
  const selectedRoutines = useMemo(
    () =>
      selectedHistoricalView?.routines ??
      (viewingToday
        ? snapshot.routines.filter((item) =>
            isScheduledOnDate(item.schedule, selectedDate),
          )
        : []),
    [selectedDate, selectedHistoricalView, snapshot.routines, viewingToday],
  );
  const progress = useMemo(() => {
    if (selectedHistoricalView) return selectedHistoricalView.progress;
    return withRecalculatedProgress({
      localDate: selectedDate,
      habits: selectedHabits,
      tasks: selectedTasks,
      routines: selectedRoutines,
      progress: { completed: 0, total: 0, ratio: 0 },
    }).progress;
  }, [
    selectedDate,
    selectedHabits,
    selectedHistoricalView,
    selectedRoutines,
    selectedTasks,
  ]);

  const value = useMemo<AtlasAppContextValue>(
    () => ({
      snapshot,
      selectedDate,
      selectedHabits,
      selectedTasks,
      selectedRoutines,
      isToday: viewingToday,
      hydrated,
      historicalDayStatus: viewingToday
        ? 'idle'
        : historicalDay.date === selectedDate
          ? historicalDay.status
          : 'loading',
      historicalDayMessage:
        !viewingToday && historicalDay.date === selectedDate
          ? historicalDay.message
          : undefined,
      progress,
      toggleHabit,
      setHabitValue,
      addHabitValue,
      skipHabit,
      pauseHabit,
      resumeHabit,
      setSelectedDate,
      timerSheetOpen,
      timerTargetId,
      openTimerSheet,
      closeTimerSheet,
      startTimer: (itemId) => runTimerAction('startTimer', [itemId]),
      pauseTimer: () => runTimerAction('pauseTimer'),
      resumeTimer: () => runTimerAction('resumeTimer'),
      stopTimer: (localDate = selectedDate) =>
        runTimerAction('stopTimer', [localDate]),
      cancelTimer: () => runTimerAction('cancelTimer'),
      recordManualDuration: async (
        itemId,
        seconds,
        localDate = selectedDate,
      ) => {
        const result = await runTimerAction('recordManualDuration', [
          itemId,
          seconds,
          localDate,
        ]);
        if (result.ok && localDate !== todayKey()) {
          await requestHistoricalDay(localDate, false).catch(() => undefined);
        }
        return result;
      },
      resolveLegacyTimers: (itemId) =>
        runTimerAction('resolveLegacyTimers', [itemId]),
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
      setRemindersEnabled: async (enabled) => {
        const method = adapterRef.current.setRemindersEnabled;
        if (!method) return adapterUnavailable('Los recordatorios');
        const result = await method.call(adapterRef.current, enabled);
        await refreshAfterAdapterMutation().catch(() => undefined);
        return result;
      },
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
      historicalDay.date,
      historicalDay.message,
      historicalDay.status,
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
      closeTimerSheet,
      openTimerSheet,
      refreshAfterAdapterMutation,
      requestHistoricalDay,
      runTimerAction,
      selectedRoutines,
      selectedTasks,
      startRoutine,
      timerSheetOpen,
      timerTargetId,
      toggleHabit,
      toggleSubtask,
      toggleTask,
      updateItem,
      viewingToday,
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
