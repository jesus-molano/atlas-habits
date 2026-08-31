/**
 * Pure domain types. Dates are local civil dates on purpose: recurrence rules
 * must not move when the device changes timezone or crosses a DST boundary.
 */
export type LocalDate = `${number}-${number}-${number}`;
export type LocalTime = `${number}:${number}`;

export interface LocalDateTime {
  date: LocalDate;
  time: LocalTime;
}

export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type HabitMetric =
  | { kind: 'boolean' }
  | { kind: 'count'; unit: string; defaultIncrement?: number }
  | { kind: 'duration'; unit: 'seconds'; defaultIncrement?: number };

export type HabitPolarity = 'build' | 'avoid';

export type GoalPeriod = 'occurrence' | 'day' | 'week' | 'month';
export type GoalAggregation =
  'sum' | 'count' | 'average' | 'latest' | 'maximum' | 'minimum';
export type GoalComparator = 'at_least' | 'at_most' | 'exactly';

/** A generic goal such as "sum at least 30 minutes per week". */
export interface HabitGoal {
  period: GoalPeriod;
  aggregation: GoalAggregation;
  comparator: GoalComparator;
  target: number;
  unit: string;
}

export type ScheduleRule =
  | { kind: 'once'; date: LocalDate }
  | { kind: 'weekdays'; days: readonly IsoWeekday[] }
  | { kind: 'interval_days'; every: number; anchorDate: LocalDate }
  | {
      kind: 'period_quota';
      period: 'week' | 'month';
      /** Number of distinct sessions expected during the flexible period. */
      quota: number;
      weekStartsOn?: IsoWeekday;
    };

export interface ScheduleSlot {
  id: string;
  /** A missing time means that the slot is all-day. */
  time?: LocalTime;
  label?: string;
}

export interface HabitPause {
  id: string;
  startDate: LocalDate;
  /** Inclusive. Missing means that the pause has no planned end. */
  endDate?: LocalDate;
  reason?: string;
}

export interface GracePeriod {
  /** Added after the normal close boundary. Can be longer than one day. */
  minutes: number;
}

export interface HabitDefinition {
  id: string;
  title: string;
  scheduleVersionId: string;
  metric: HabitMetric;
  polarity: HabitPolarity;
  goal: HabitGoal;
  schedule: ScheduleRule;
  /** Empty means one implicit all-day slot. */
  slots: readonly ScheduleSlot[];
  activeFrom: LocalDate;
  /** Inclusive. */
  activeUntil?: LocalDate;
  pauses?: readonly HabitPause[];
  grace?: GracePeriod;
}

export interface DateRange {
  from: LocalDate;
  to: LocalDate;
}

export interface ScheduledOccurrence {
  id: string;
  habitId: string;
  scheduleVersionId: string;
  slotId: string;
  slotLabel?: string;
  nominalDate: LocalDate;
  scheduledAt?: LocalDateTime;
  /** Inclusive civil-date window in which measurements belong. */
  startDate: LocalDate;
  endDate: LocalDate;
  dueAt: LocalDateTime;
  closesAt: LocalDateTime;
  expectedCompletions: number;
  state: 'active' | 'paused';
  pauseIds: readonly string[];
  /** Useful when a pause covers only part of a flexible quota period. */
  pausedDates: readonly LocalDate[];
}

export interface ProgressWindow {
  id: string;
  habitId: string;
  period: GoalPeriod;
  periodKey: string;
  startDate: LocalDate;
  endDate: LocalDate;
  dueAt: LocalDateTime;
  closesAt: LocalDateTime;
  occurrences: readonly ScheduledOccurrence[];
}

export type MeasurementOperation = 'add' | 'set';

/**
 * Immutable input to an aggregate. Corrections can be stored as a later `set`
 * entry or by tombstoning an entry in persistence before calling the engine.
 */
export interface HabitMeasurement {
  id: string;
  habitId: string;
  occurrenceId?: string;
  sessionId?: string;
  localDate: LocalDate;
  amount: number;
  operation: MeasurementOperation;
  recordedAtMs: number;
}

export type OccurrenceOverrideStatus = 'complete' | 'excused' | 'reset';

export interface OccurrenceOverride {
  id: string;
  habitId: string;
  occurrenceId: string;
  status: OccurrenceOverrideStatus;
  updatedAtMs: number;
  reason?: string;
}

export interface AggregationStep {
  measurementId: string;
  operation: MeasurementOperation;
  amount: number;
  before: number | null;
  after: number | null;
  included: boolean;
  reason: 'applied' | 'duplicate_session' | 'not_in_window' | 'wrong_habit';
}

export type ProgressStatus =
  'pending' | 'completed' | 'missed' | 'failed' | 'excused' | 'paused';

export type ProgressReason =
  | 'goal_reached'
  | 'goal_reached_but_period_open'
  | 'goal_not_reached'
  | 'deadline_passed'
  | 'avoid_limit_exceeded'
  | 'manual_completion'
  | 'all_occurrences_excused'
  | 'all_occurrences_paused'
  | 'waiting_for_sessions';

export interface ProgressResult {
  window: ProgressWindow;
  status: ProgressStatus;
  reason: ProgressReason;
  value: number;
  target: number;
  comparator: GoalComparator;
  aggregation: GoalAggregation;
  satisfied: boolean;
  /** Goal distance. Zero means that the comparator is currently satisfied. */
  remaining: number;
  /** A normalized display value. It is always between zero and one. */
  ratio: number;
  expectedCompletions: number;
  capturedSessions: number;
  quotaSatisfied: boolean;
  manualCompletedOccurrenceIds: readonly string[];
  excusedOccurrenceIds: readonly string[];
  pausedOccurrenceIds: readonly string[];
  ignoredMeasurementIds: readonly string[];
  aggregationSteps: readonly AggregationStep[];
}

export type StreakDecision = 'increment' | 'break' | 'neutral' | 'ignored';

export interface StreakStep {
  windowId: string;
  periodKey: string;
  status: ProgressStatus;
  decision: StreakDecision;
  reason:
    | 'completed_counts'
    | 'missed_breaks'
    | 'failed_breaks'
    | 'excused_does_not_break'
    | 'pause_does_not_break'
    | 'open_period_ignored';
  streakAfter: number;
}

export interface StreakResult {
  current: number;
  best: number;
  unit: GoalPeriod;
  steps: readonly StreakStep[];
}

export interface DomainIssue {
  severity: 'error' | 'warning';
  path: string;
  code: string;
  message: string;
}

export interface HabitTimelineInput extends DateRange {
  asOf: LocalDateTime;
  measurements?: readonly HabitMeasurement[];
  overrides?: readonly OccurrenceOverride[];
  weekStartsOn?: IsoWeekday;
}

export interface HabitTimeline {
  occurrences: readonly ScheduledOccurrence[];
  windows: readonly ProgressWindow[];
  progress: readonly ProgressResult[];
  streak: StreakResult;
}
