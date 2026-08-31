import type { IsoWeekday, LocalDate, LocalDateTime, LocalTime } from './model';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;
const DAY_MS = 86_400_000;

function parts(date: LocalDate): [number, number, number] {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new Error(`Invalid local date: ${date}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function timeParts(time: LocalTime): [number, number] {
  const match = TIME_PATTERN.exec(time);
  if (!match) throw new Error(`Invalid local time: ${time}`);
  return [Number(match[1]), Number(match[2])];
}

export function isLocalDate(value: string): value is LocalDate {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function isLocalTime(value: string): value is LocalTime {
  const match = TIME_PATTERN.exec(value);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function toVirtualUtcMs(dateTime: LocalDateTime): number {
  const [year, month, day] = parts(dateTime.date);
  const [hour, minute] = timeParts(dateTime.time);
  return Date.UTC(year, month - 1, day, hour, minute);
}

function formatDate(date: Date): LocalDate {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}` as LocalDate;
}

function formatTime(date: Date): LocalTime {
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hour}:${minute}` as LocalTime;
}

export function compareDates(left: LocalDate, right: LocalDate): number {
  return left.localeCompare(right);
}

export function compareDateTimes(
  left: LocalDateTime,
  right: LocalDateTime,
): number {
  return toVirtualUtcMs(left) - toVirtualUtcMs(right);
}

export function minDate(left: LocalDate, right: LocalDate): LocalDate {
  return compareDates(left, right) <= 0 ? left : right;
}

export function maxDate(left: LocalDate, right: LocalDate): LocalDate {
  return compareDates(left, right) >= 0 ? left : right;
}

export function minDateTime(
  left: LocalDateTime,
  right: LocalDateTime,
): LocalDateTime {
  return compareDateTimes(left, right) <= 0 ? left : right;
}

export function maxDateTime(
  left: LocalDateTime,
  right: LocalDateTime,
): LocalDateTime {
  return compareDateTimes(left, right) >= 0 ? left : right;
}

export function addDays(date: LocalDate, count: number): LocalDate {
  const [year, month, day] = parts(date);
  return formatDate(new Date(Date.UTC(year, month - 1, day + count)));
}

export function addMinutes(
  dateTime: LocalDateTime,
  count: number,
): LocalDateTime {
  const result = new Date(toVirtualUtcMs(dateTime) + count * 60_000);
  return { date: formatDate(result), time: formatTime(result) };
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  const fromMs = toVirtualUtcMs({ date: from, time: '00:00' });
  const toMs = toVirtualUtcMs({ date: to, time: '00:00' });
  return Math.round((toMs - fromMs) / DAY_MS);
}

export function isoWeekday(date: LocalDate): IsoWeekday {
  const [year, month, day] = parts(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (weekday === 0 ? 7 : weekday) as IsoWeekday;
}

export function startOfWeek(
  date: LocalDate,
  weekStartsOn: IsoWeekday = 1,
): LocalDate {
  const distance = (isoWeekday(date) - weekStartsOn + 7) % 7;
  return addDays(date, -distance);
}

export function endOfWeek(
  date: LocalDate,
  weekStartsOn: IsoWeekday = 1,
): LocalDate {
  return addDays(startOfWeek(date, weekStartsOn), 6);
}

export function startOfMonth(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01` as LocalDate;
}

export function endOfMonth(date: LocalDate): LocalDate {
  const [year, month] = parts(date);
  return formatDate(new Date(Date.UTC(year, month, 0)));
}

export function eachDate(range: {
  from: LocalDate;
  to: LocalDate;
}): LocalDate[] {
  if (compareDates(range.from, range.to) > 0) return [];
  const dates: LocalDate[] = [];
  for (
    let date = range.from;
    compareDates(date, range.to) <= 0;
    date = addDays(date, 1)
  ) {
    dates.push(date);
  }
  return dates;
}

export function dateIsInRange(
  date: LocalDate,
  range: { startDate: LocalDate; endDate?: LocalDate },
): boolean {
  return (
    compareDates(date, range.startDate) >= 0 &&
    (!range.endDate || compareDates(date, range.endDate) <= 0)
  );
}

export function rangesOverlap(
  left: { from: LocalDate; to: LocalDate },
  right: { from: LocalDate; to: LocalDate },
): boolean {
  return (
    compareDates(left.from, right.to) <= 0 &&
    compareDates(right.from, left.to) <= 0
  );
}

export function periodBounds(
  date: LocalDate,
  period: 'day' | 'week' | 'month',
  weekStartsOn: IsoWeekday = 1,
): { from: LocalDate; to: LocalDate; key: string } {
  if (period === 'day') return { from: date, to: date, key: date };
  if (period === 'week') {
    const from = startOfWeek(date, weekStartsOn);
    return { from, to: addDays(from, 6), key: from };
  }
  const from = startOfMonth(date);
  return { from, to: endOfMonth(date), key: date.slice(0, 7) };
}
