import { daysBetween, isoWeekday, type LocalDate } from '../../domain';

import type {
  AtlasReminder,
  AtlasSchedule,
  AtlasScheduleSlot,
  AtlasWeekday,
} from './types';

const WEEKDAY_LABELS: Record<AtlasWeekday, string> = {
  1: 'lun',
  2: 'mar',
  3: 'mié',
  4: 'jue',
  5: 'vie',
  6: 'sáb',
  7: 'dom',
};

export function localDateToday(now = new Date()): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createDefaultSchedule(
  startDate = localDateToday(),
): AtlasSchedule {
  return { kind: 'daily', startDate, slots: [] };
}

function uniqueSlots(slots: readonly AtlasScheduleSlot[]): AtlasScheduleSlot[] {
  const seen = new Set<string>();
  return slots.flatMap((slot) => {
    const id = slot.id.trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [
      {
        id,
        ...(slot.time?.trim() ? { time: slot.time.trim() } : {}),
        ...(slot.label?.trim() ? { label: slot.label.trim() } : {}),
      },
    ];
  });
}

export function normalizeSchedule(schedule: AtlasSchedule): AtlasSchedule {
  const slots = uniqueSlots(schedule.slots);
  switch (schedule.kind) {
    case 'once':
      return { ...schedule, startDate: schedule.date, slots };
    case 'daily':
      return { ...schedule, slots };
    case 'weekdays': {
      const days = [...new Set(schedule.days)]
        .filter((day): day is AtlasWeekday => day >= 1 && day <= 7)
        .sort((left, right) => left - right);
      return {
        ...schedule,
        days: days.length > 0 ? days : [1, 2, 3, 4, 5, 6, 7],
        slots,
      };
    }
    case 'interval_days':
      return {
        ...schedule,
        every: Math.max(1, Math.round(schedule.every)),
        anchorDate: schedule.anchorDate || schedule.startDate,
        slots,
      };
    case 'period_quota':
      return {
        ...schedule,
        quota: Math.max(1, Math.round(schedule.quota)),
        weekStartsOn:
          schedule.weekStartsOn >= 1 && schedule.weekStartsOn <= 7
            ? schedule.weekStartsOn
            : 1,
        slots,
      };
  }
}

export function scheduleLabel(schedule: AtlasSchedule): string {
  const normalized = normalizeSchedule(schedule);
  let recurrence: string;
  switch (normalized.kind) {
    case 'once':
      recurrence = `Una vez · ${normalized.date}`;
      break;
    case 'daily':
      recurrence = 'Todos los días';
      break;
    case 'weekdays':
      recurrence =
        normalized.days.length === 7
          ? 'Todos los días'
          : normalized.days.map((day) => WEEKDAY_LABELS[day]).join(', ');
      break;
    case 'interval_days':
      recurrence =
        normalized.every === 1
          ? 'Todos los días'
          : `Cada ${normalized.every} días`;
      break;
    case 'period_quota':
      recurrence = `${normalized.quota} ${
        normalized.quota === 1 ? 'vez' : 'veces'
      } por ${normalized.period === 'month' ? 'mes' : 'semana'}`;
      break;
  }
  const times = normalized.slots.flatMap((slot) => slot.time ?? []);
  return times.length > 0 ? `${recurrence} · ${times.join(', ')}` : recurrence;
}

export function isScheduledOnDate(
  schedule: AtlasSchedule,
  localDate: string,
): boolean {
  const normalized = normalizeSchedule(schedule);
  if (localDate < normalized.startDate) return false;
  switch (normalized.kind) {
    case 'once':
      return localDate === normalized.date;
    case 'daily':
    case 'period_quota':
      return true;
    case 'weekdays':
      return normalized.days.includes(isoWeekday(localDate as LocalDate));
    case 'interval_days': {
      const distance = daysBetween(
        normalized.anchorDate as LocalDate,
        localDate as LocalDate,
      );
      return distance >= 0 && distance % normalized.every === 0;
    }
  }
}

/** Checkpoints multiply fixed daily completions, never a flexible quota. */
export function expectedCompletions(schedule: AtlasSchedule): number {
  const normalized = normalizeSchedule(schedule);
  if (normalized.kind === 'period_quota') return normalized.quota;
  return Math.max(1, normalized.slots.length);
}

export function firstReminderTime(
  reminders: readonly AtlasReminder[],
): string | undefined {
  return reminders.find((reminder) => reminder.enabled)?.time;
}
