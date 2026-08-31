import { addDays, type LocalDate } from '../../domain';

export type TaskOccurrenceTimestamps = Readonly<{
  dueAt: number | null;
  deadlineAt: number | null;
}>;

export function taskDefinitionUiValue(
  timestamp: number | null,
): string | undefined {
  if (timestamp === null || !Number.isFinite(timestamp)) return undefined;
  const value = new Date(timestamp);
  const date = localDateFromTimestamp(timestamp);
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${date} · ${hours}:${minutes}`;
}

type TaskOccurrenceInput = Readonly<{
  definitionDueAt: number | null;
  definitionDeadlineAt: number | null;
  instanceDueAt?: number | null;
  instanceDeadlineAt?: number | null;
  localDate: LocalDate;
  recurring: boolean;
}>;

function localDateFromTimestamp(timestamp: number): LocalDate {
  const value = new Date(timestamp);
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}` as LocalDate;
}

function localTimestamp(date: LocalDate, source: Date): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(
    year,
    month - 1,
    day,
    source.getHours(),
    source.getMinutes(),
    source.getSeconds(),
    source.getMilliseconds(),
  ).getTime();
}

function shiftCivilTimestamp(
  timestamp: number | null,
  anchorDate: LocalDate,
  occurrenceDate: LocalDate,
): number | null {
  if (timestamp === null || !Number.isFinite(timestamp)) return null;
  const source = new Date(timestamp);
  const sourceDate = localDateFromTimestamp(timestamp);
  let offset = 0;
  let cursor = anchorDate;

  while (cursor < sourceDate) {
    cursor = addDays(cursor, 1);
    offset += 1;
  }
  while (cursor > sourceDate) {
    cursor = addDays(cursor, -1);
    offset -= 1;
  }

  return localTimestamp(addDays(occurrenceDate, offset), source);
}

/**
 * Resolve the concrete date/time for a task occurrence without adding fixed
 * milliseconds. This keeps the configured wall-clock time across DST changes.
 */
export function taskOccurrenceTimestamps({
  definitionDueAt,
  definitionDeadlineAt,
  instanceDueAt,
  instanceDeadlineAt,
  localDate,
  recurring,
}: TaskOccurrenceInput): TaskOccurrenceTimestamps {
  if (instanceDueAt !== undefined || instanceDeadlineAt !== undefined) {
    return {
      dueAt: instanceDueAt ?? null,
      deadlineAt: instanceDeadlineAt ?? null,
    };
  }

  if (!recurring) {
    return { dueAt: definitionDueAt, deadlineAt: definitionDeadlineAt };
  }

  const anchorTimestamp = definitionDueAt ?? definitionDeadlineAt;
  if (anchorTimestamp === null || !Number.isFinite(anchorTimestamp)) {
    return { dueAt: null, deadlineAt: null };
  }
  const anchorDate = localDateFromTimestamp(anchorTimestamp);
  if (localDate < anchorDate) {
    return { dueAt: null, deadlineAt: null };
  }

  return {
    dueAt: shiftCivilTimestamp(definitionDueAt, anchorDate, localDate),
    deadlineAt: shiftCivilTimestamp(
      definitionDeadlineAt,
      anchorDate,
      localDate,
    ),
  };
}
