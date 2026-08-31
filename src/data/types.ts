export type ItemType = 'habit' | 'task' | 'routine';

export type MeasurementType = 'boolean' | 'quantity' | 'duration';

export type ScheduleRuleType =
  'once' | 'daily' | 'weekdays' | 'interval' | 'period_quota';

export type ItemRecord = {
  id: string;
  workspaceId: string;
  type: ItemType;
  title: string;
  notes: string | null;
  color: string | null;
  icon: string | null;
  categoryId: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  deletedAt: number | null;
};

export type HabitRecord = ItemRecord & {
  type: 'habit';
  measurementType: MeasurementType;
  unit: string | null;
  defaultValue: number;
};

export type TaskRecord = ItemRecord & {
  type: 'task';
  priority: 0 | 1 | 2 | 3;
  allDay: boolean;
  dueAt: number | null;
  deadlineAt: number | null;
};

export type RoutineRecord = ItemRecord & {
  type: 'routine';
  completionPolicy: 'all_required' | 'manual';
};

export type ScheduleVersionInput = {
  effectiveFrom: string;
  effectiveUntil?: string | null;
  ruleType: ScheduleRuleType;
  /** JSON-safe rule details interpreted by the domain schedule engine. */
  rule: Record<string, unknown>;
  graceMinutes?: number;
  slots?: ScheduleSlotInput[];
  goals?: ScheduleGoalInput[];
};

export type ScheduleSlotInput = {
  id?: string;
  key: string;
  label?: string | null;
  localTime?: string | null;
  sortOrder?: number;
};

export type ScheduleGoalInput = {
  id?: string;
  slotId?: string | null;
  slotKey?: string | null;
  measurementType: MeasurementType;
  aggregation?: 'count' | 'sum' | 'duration';
  comparison?: 'at_least' | 'at_most' | 'exactly';
  targetValue: number;
  unit?: string | null;
};

export type DashboardItem = ItemRecord & {
  categoryName: string | null;
  categoryColor: string | null;
  tagIds: string[];
  isPaused: boolean;
  subtypeJson: string;
};

export type DashboardMeasurement = {
  id: string;
  itemId: string;
  occurrenceKey: string | null;
  sessionId: string | null;
  scheduleVersionId: string | null;
  slotId: string | null;
  value: number;
  operation: 'add' | 'set';
  unit: string | null;
  occurredAt: number;
  localDate: string;
  note: string | null;
};

export type DashboardOccurrenceOverride = {
  id: string;
  itemId: string;
  occurrenceKey: string;
  localDate: string;
  slotId: string | null;
  state: 'complete' | 'excused' | 'reset' | 'force_due' | 'force_not_due';
  value: number | null;
  note: string | null;
  updatedAt: number;
};

export type DashboardTaskInstance = {
  id: string;
  taskId: string;
  occurrenceKey: string;
  localDate: string;
  scheduledFor: number | null;
  dueAt: number | null;
  deadlineAt: number | null;
  status: 'pending' | 'completed' | 'skipped' | 'cancelled';
  completedAt: number | null;
  snoozedUntil: number | null;
};

export type DashboardRoutineRun = {
  id: string;
  routineId: string;
  occurrenceKey: string | null;
  localDate: string;
  status: 'running' | 'completed' | 'abandoned';
  startedAt: number;
  finishedAt: number | null;
};

export type DashboardSnapshot = {
  localDate: string;
  items: DashboardItem[];
  scheduleVersions: DashboardScheduleVersion[];
  scheduleSlots: DashboardScheduleSlot[];
  scheduleGoals: DashboardScheduleGoal[];
  measurements: DashboardMeasurement[];
  overrides: DashboardOccurrenceOverride[];
  taskInstances: DashboardTaskInstance[];
  routineRuns: DashboardRoutineRun[];
};

export type DashboardScheduleVersion = {
  id: string;
  scheduleId: string;
  itemId: string;
  timezone: string;
  versionNumber: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  ruleType: ScheduleRuleType;
  rule: Record<string, unknown>;
  graceMinutes: number;
};

export type DashboardScheduleSlot = {
  id: string;
  scheduleVersionId: string;
  key: string;
  label: string | null;
  localTime: string | null;
  sortOrder: number;
};

export type DashboardScheduleGoal = {
  id: string;
  scheduleVersionId: string;
  slotId: string | null;
  measurementType: MeasurementType;
  aggregation: 'count' | 'sum' | 'duration';
  comparison: 'at_least' | 'at_most' | 'exactly';
  targetValue: number;
  unit: string | null;
};

export type CommandExecution<T> = {
  value: T;
  replayed: boolean;
};

export type OplogOperation = 'upsert' | 'delete';

export type OplogMutation = {
  commandId: string;
  deviceId: string;
  entityType: string;
  entityId: string;
  workspaceId?: string;
  operation: OplogOperation;
  payload: unknown;
  changedFields?: readonly string[];
  observedHlc?: string | null;
  now?: number;
};

export const LOCAL_WORKSPACE_ID = 'local-personal';
