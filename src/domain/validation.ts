import { compareDates, isLocalDate, isLocalTime } from './date';
import type { DomainIssue, HabitDefinition } from './model';

function error(path: string, code: string, message: string): DomainIssue {
  return { severity: 'error', path, code, message };
}

function warning(path: string, code: string, message: string): DomainIssue {
  return { severity: 'warning', path, code, message };
}

export function validateHabitDefinition(habit: HabitDefinition): DomainIssue[] {
  const issues: DomainIssue[] = [];

  if (!habit.id.trim())
    issues.push(error('id', 'required', 'Habit id is required.'));
  if (!habit.title.trim())
    issues.push(error('title', 'required', 'Habit title is required.'));
  if (!habit.scheduleVersionId.trim()) {
    issues.push(
      error(
        'scheduleVersionId',
        'required',
        'Schedule version id is required.',
      ),
    );
  }
  if (!isLocalDate(habit.activeFrom)) {
    issues.push(
      error('activeFrom', 'invalid_date', 'Active-from must be YYYY-MM-DD.'),
    );
  }
  if (habit.activeUntil && !isLocalDate(habit.activeUntil)) {
    issues.push(
      error('activeUntil', 'invalid_date', 'Active-until must be YYYY-MM-DD.'),
    );
  }
  if (
    isLocalDate(habit.activeFrom) &&
    habit.activeUntil &&
    isLocalDate(habit.activeUntil) &&
    compareDates(habit.activeFrom, habit.activeUntil) > 0
  ) {
    issues.push(
      error(
        'activeUntil',
        'invalid_range',
        'Active-until is before active-from.',
      ),
    );
  }

  if (!Number.isFinite(habit.goal.target) || habit.goal.target < 0) {
    issues.push(
      error(
        'goal.target',
        'invalid_target',
        'Goal target must be a finite non-negative number.',
      ),
    );
  }
  if (!habit.goal.unit.trim()) {
    issues.push(error('goal.unit', 'required', 'Goal unit is required.'));
  }
  if (
    habit.metric.kind === 'boolean' &&
    habit.goal.aggregation === 'latest' &&
    habit.goal.target > 1
  ) {
    issues.push(
      warning(
        'goal.target',
        'boolean_latest_above_one',
        'A latest boolean value normally uses a target between zero and one.',
      ),
    );
  }
  if (habit.polarity === 'avoid' && habit.goal.comparator !== 'at_most') {
    issues.push(
      warning(
        'goal.comparator',
        'unusual_avoid_comparator',
        'Avoid habits normally use an at-most comparator.',
      ),
    );
  }

  const slotIds = new Set<string>();
  habit.slots.forEach((slot, index) => {
    if (!slot.id.trim())
      issues.push(
        error(`slots.${index}.id`, 'required', 'Slot id is required.'),
      );
    if (slotIds.has(slot.id)) {
      issues.push(
        error(
          `slots.${index}.id`,
          'duplicate',
          `Duplicate slot id: ${slot.id}.`,
        ),
      );
    }
    slotIds.add(slot.id);
    if (slot.time && !isLocalTime(slot.time)) {
      issues.push(
        error(
          `slots.${index}.time`,
          'invalid_time',
          'Slot time must be HH:mm.',
        ),
      );
    }
  });

  if (
    habit.grace &&
    (!Number.isFinite(habit.grace.minutes) || habit.grace.minutes < 0)
  ) {
    issues.push(
      error(
        'grace.minutes',
        'invalid_grace',
        'Grace minutes must be a finite non-negative number.',
      ),
    );
  }

  switch (habit.schedule.kind) {
    case 'once':
      if (!isLocalDate(habit.schedule.date)) {
        issues.push(
          error(
            'schedule.date',
            'invalid_date',
            'Once date must be YYYY-MM-DD.',
          ),
        );
      }
      break;
    case 'weekdays': {
      if (habit.schedule.days.length === 0) {
        issues.push(
          error('schedule.days', 'empty', 'Select at least one weekday.'),
        );
      }
      const uniqueDays = new Set(habit.schedule.days);
      if (uniqueDays.size !== habit.schedule.days.length) {
        issues.push(
          error(
            'schedule.days',
            'duplicate',
            'Weekdays must not contain duplicates.',
          ),
        );
      }
      if (habit.schedule.days.some((day) => day < 1 || day > 7)) {
        issues.push(
          error(
            'schedule.days',
            'invalid_weekday',
            'ISO weekdays must be between 1 and 7.',
          ),
        );
      }
      break;
    }
    case 'interval_days':
      if (!Number.isInteger(habit.schedule.every) || habit.schedule.every < 1) {
        issues.push(
          error(
            'schedule.every',
            'invalid_interval',
            'Interval must be a positive integer.',
          ),
        );
      }
      if (!isLocalDate(habit.schedule.anchorDate)) {
        issues.push(
          error(
            'schedule.anchorDate',
            'invalid_date',
            'Anchor date must be YYYY-MM-DD.',
          ),
        );
      }
      break;
    case 'period_quota':
      if (!Number.isInteger(habit.schedule.quota) || habit.schedule.quota < 1) {
        issues.push(
          error(
            'schedule.quota',
            'invalid_quota',
            'Quota must be a positive integer.',
          ),
        );
      }
      if (
        habit.schedule.weekStartsOn !== undefined &&
        (habit.schedule.weekStartsOn < 1 || habit.schedule.weekStartsOn > 7)
      ) {
        issues.push(
          error(
            'schedule.weekStartsOn',
            'invalid_weekday',
            'Week start must be between 1 and 7.',
          ),
        );
      }
      if (habit.polarity === 'avoid') {
        issues.push(
          warning(
            'schedule',
            'avoid_quota',
            'A flexible completion quota is normally not useful for an avoid habit.',
          ),
        );
      }
      break;
  }

  habit.pauses?.forEach((pause, index) => {
    if (!pause.id.trim())
      issues.push(
        error(`pauses.${index}.id`, 'required', 'Pause id is required.'),
      );
    if (!isLocalDate(pause.startDate)) {
      issues.push(
        error(
          `pauses.${index}.startDate`,
          'invalid_date',
          'Pause start must be YYYY-MM-DD.',
        ),
      );
    }
    if (pause.endDate && !isLocalDate(pause.endDate)) {
      issues.push(
        error(
          `pauses.${index}.endDate`,
          'invalid_date',
          'Pause end must be YYYY-MM-DD.',
        ),
      );
    }
    if (
      pause.endDate &&
      isLocalDate(pause.startDate) &&
      isLocalDate(pause.endDate) &&
      compareDates(pause.startDate, pause.endDate) > 0
    ) {
      issues.push(
        error(
          `pauses.${index}.endDate`,
          'invalid_range',
          'Pause end is before its start.',
        ),
      );
    }
  });

  return issues;
}

export class DomainValidationError extends Error {
  readonly issues: readonly DomainIssue[];

  constructor(issues: readonly DomainIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
    this.name = 'DomainValidationError';
    this.issues = issues;
  }
}

export function assertValidHabitDefinition(habit: HabitDefinition): void {
  const errors = validateHabitDefinition(habit).filter(
    (issue) => issue.severity === 'error',
  );
  if (errors.length > 0) throw new DomainValidationError(errors);
}
