export type HabitMetric = 'boolean' | 'count' | 'duration';

export type Priority = 'low' | 'medium' | 'high';

export type AtlasWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type AtlasScheduleSlot = {
  id: string;
  time?: string;
  label?: string;
};

type AtlasScheduleBase = {
  startDate: string;
  slots: AtlasScheduleSlot[];
};

export type AtlasSchedule =
  | (AtlasScheduleBase & { kind: 'once'; date: string })
  | (AtlasScheduleBase & { kind: 'daily' })
  | (AtlasScheduleBase & { kind: 'weekdays'; days: AtlasWeekday[] })
  | (AtlasScheduleBase & {
      kind: 'interval_days';
      every: number;
      anchorDate: string;
    })
  | (AtlasScheduleBase & {
      kind: 'period_quota';
      period: 'week' | 'month';
      quota: number;
      weekStartsOn: AtlasWeekday;
    });

export type AtlasReminder = {
  id: string;
  time: string;
  label?: string;
  scheduleSlotId?: string;
  enabled: boolean;
  /** Exact alarms require explicit Android special access. New rules are flexible. */
  exactAlarm?: boolean;
  snoozeMinutes: number;
};

export type DashboardSectionId = 'routines' | 'habits' | 'tasks';

export type AtlasItemBase = {
  id: string;
  title: string;
  notes?: string;
  category?: string;
  tags: string[];
  schedule: AtlasSchedule;
  reminders: AtlasReminder[];
  /** Derived display value. Never use it as recurrence input. */
  scheduleLabel: string;
  /** Compatibility display value for the first enabled reminder. */
  reminderTime?: string;
  sortOrder: number;
};

export type HabitItem = AtlasItemBase & {
  kind: 'habit';
  metric: HabitMetric;
  target: number;
  unit: string;
  value: number;
  completed: boolean;
  skipped?: boolean;
  paused?: boolean;
  pauseUntil?: string;
  graceMinutes?: number;
  streak: number;
  timerStartedAt?: number;
};

export type TaskSubtask = {
  id: string;
  title: string;
  completed: boolean;
  required: boolean;
};

export type TaskItem = AtlasItemBase & {
  kind: 'task';
  priority: Priority;
  /** Editable date/time stored on the task definition. */
  dueAt?: string;
  deadlineAt?: string;
  /** Date/time for the occurrence represented by the current snapshot. */
  occurrenceDueAt?: string;
  occurrenceDeadlineAt?: string;
  recurring: boolean;
  completed: boolean;
  subtasks: TaskSubtask[];
};

export type RoutineStep = {
  id: string;
  title: string;
  required: boolean;
  durationSeconds?: number;
  completed: boolean;
};

export type RoutineItem = AtlasItemBase & {
  kind: 'routine';
  steps: RoutineStep[];
  completed: boolean;
  running: boolean;
};

export type AtlasItem = HabitItem | TaskItem | RoutineItem;

export type HistoryDay = {
  date: string;
  ratio: number;
  focusSeconds: number;
};

export type ActiveTimerState = Readonly<{
  itemId: string;
  itemType: 'habit' | 'task';
  title: string;
  startedAt: number;
  runningSince?: number;
  elapsedSeconds: number;
}>;

export type ReminderCapability = Readonly<{
  masterEnabled: boolean;
  notifications: 'granted' | 'askable' | 'blocked' | 'not-applicable';
  exactAlarms: 'granted' | 'needs-settings' | 'not-applicable';
}>;

export type SyncIssue = Readonly<{
  kind:
    | 'cancelled'
    | 'network'
    | 'google-provider-disabled'
    | 'credentials-configuration'
    | 'firestore-permission'
    | 'firestore-setup'
    | 'account-not-authorized'
    | 'remote-integrity'
    | 'unknown';
  remediation:
    'retry' | 'network' | 'google-config' | 'firestore-access' | 'none';
}>;

export type HabitDayRecord = {
  value: number;
  completed: boolean;
  skipped?: boolean;
  paused?: boolean;
  scheduled?: boolean;
};

export type SyncState = {
  status: 'local-only' | 'connecting' | 'connected' | 'error';
  accountEmail?: string;
  message?: string;
  issue?: SyncIssue;
};

export type AtlasSnapshot = {
  schemaVersion: 1;
  habits: HabitItem[];
  tasks: TaskItem[];
  routines: RoutineItem[];
  dashboardOrder: DashboardSectionId[];
  history: HistoryDay[];
  habitHistory: Record<string, Record<string, HabitDayRecord>>;
  sync: SyncState;
  activeTimer?: ActiveTimerState;
  legacyTimerItemIds?: string[];
  reminderCapability?: ReminderCapability;
  source: 'local_store' | 'external_service';
};

export type CreateHabitDraft = {
  kind: 'habit';
  title: string;
  notes?: string;
  category?: string;
  tags?: string[];
  metric: HabitMetric;
  target: number;
  unit: string;
  schedule: AtlasSchedule;
  reminders: AtlasReminder[];
  graceMinutes?: number;
};

export type CreateTaskDraft = {
  kind: 'task';
  title: string;
  notes?: string;
  category?: string;
  tags?: string[];
  priority: Priority;
  dueAt?: string;
  deadlineAt?: string;
  recurring: boolean;
  schedule: AtlasSchedule;
  reminders: AtlasReminder[];
  subtasks: { id?: string; title: string; required: boolean }[];
};

export type CreateRoutineDraft = {
  kind: 'routine';
  title: string;
  notes?: string;
  category?: string;
  tags?: string[];
  schedule: AtlasSchedule;
  reminders: AtlasReminder[];
  steps: {
    id?: string;
    title: string;
    required: boolean;
    durationSeconds?: number;
  }[];
};

export type CreateItemDraft =
  CreateHabitDraft | CreateTaskDraft | CreateRoutineDraft;

export type AdapterActionResult = {
  ok: boolean;
  message: string;
  accountEmail?: string;
  code?:
    | 'settings-opened'
    | 'permission-denied'
    | 'storage-failed'
    | 'reminder-reconcile-failed'
    | 'already-active'
    | 'invalid-target'
    | 'unavailable';
  syncIssue?: SyncIssue;
};

/**
 * Integration seam for SQLite/Firebase/native services. The UI never assumes
 * that an optional cloud or platform capability exists.
 */
export type AtlasAppAdapter = {
  loadSnapshot(): Promise<AtlasSnapshot | null>;
  /** Pure canonical read. It must not start sync or platform maintenance. */
  refreshSnapshot?(): Promise<AtlasSnapshot | null>;
  saveSnapshot(snapshot: AtlasSnapshot, localDate?: string): Promise<void>;
  subscribeToSnapshotInvalidations?(listener: () => void): () => void;
  connectGoogle?(): Promise<AdapterActionResult>;
  disconnectGoogle?(): Promise<AdapterActionResult>;
  requestNotificationAccess?(): Promise<AdapterActionResult>;
  requestExactAlarmAccess?(): Promise<AdapterActionResult>;
  setRemindersEnabled?(enabled: boolean): Promise<AdapterActionResult>;
  startTimer?(itemId: string): Promise<AdapterActionResult>;
  pauseTimer?(): Promise<AdapterActionResult>;
  resumeTimer?(): Promise<AdapterActionResult>;
  stopTimer?(localDate: string): Promise<AdapterActionResult>;
  cancelTimer?(): Promise<AdapterActionResult>;
  recordManualDuration?(
    itemId: string,
    seconds: number,
    localDate: string,
  ): Promise<AdapterActionResult>;
  resolveLegacyTimers?(itemId: string | null): Promise<AdapterActionResult>;
  checkForUpdate?(): Promise<AdapterActionResult>;
};
