import { addDays, type LocalDate, type LocalTime } from '../domain';

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const LOCAL_TIME_PATTERN = /^\d{2}:\d{2}$/u;

export function localDateFromDate(value: Date): LocalDate {
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}` as LocalDate;
}

export function localTimeFromDate(value: Date): LocalTime {
  const hour = String(value.getHours()).padStart(2, '0');
  const minute = String(value.getMinutes()).padStart(2, '0');
  return `${hour}:${minute}` as LocalTime;
}

export function recentLocalDates(today: LocalDate, count: number): LocalDate[] {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError('count must be a positive integer.');
  }
  return Array.from({ length: count }, (_, index) =>
    addDays(today, index - count + 1),
  );
}

export function occurrenceKeyForItem(
  kind: 'habit' | 'task' | 'routine' | 'routine-step',
  itemId: string,
  localDate: LocalDate,
): string {
  return `atlas:v1:${kind}:${encodeURIComponent(itemId)}:${localDate}`;
}

export function localDateFromOccurrenceKey(
  occurrenceKey: string,
): LocalDate | null {
  const candidate = occurrenceKey.slice(-10);
  return LOCAL_DATE_PATTERN.test(candidate) ? (candidate as LocalDate) : null;
}

export function normalizeReminderTime(
  value: string | undefined,
): LocalTime | null {
  if (!value || !LOCAL_TIME_PATTERN.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  if (hour > 23 || minute > 59) return null;
  return value as LocalTime;
}

export function timestampFromUiValue(
  value: string | undefined,
  localDate: LocalDate,
): number | null {
  const normalized = value?.trim();
  if (!normalized) return null;

  if (LOCAL_TIME_PATTERN.test(normalized)) {
    const timestamp = new Date(`${localDate}T${normalized}:00`).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  const timestamp = Date.parse(normalized.replace(/\s*·\s*/u, 'T'));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function uiTimeFromTimestamp(
  timestamp: number | null,
  localDate: LocalDate,
): string | undefined {
  if (timestamp === null || !Number.isFinite(timestamp)) return undefined;
  const value = new Date(timestamp);
  const time = localTimeFromDate(value);
  return localDateFromDate(value) === localDate
    ? time
    : `${localDateFromDate(value)} ${time}`;
}
