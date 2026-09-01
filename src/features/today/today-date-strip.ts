import {
  addDays,
  compareDates,
  daysBetween,
  isLocalDate,
  type LocalDate,
} from '../../domain';

export const TODAY_DATE_STRIP_PAST_DAYS = 20_000;
export const TODAY_DATE_STRIP_TODAY_INDEX = TODAY_DATE_STRIP_PAST_DAYS;
export const TODAY_DATE_STRIP_ITEM_COUNT = TODAY_DATE_STRIP_PAST_DAYS + 1;

export const TODAY_DATE_STRIP_INDICES: readonly number[] = Array.from(
  { length: TODAY_DATE_STRIP_ITEM_COUNT },
  (_, index) => index,
);

function checkedDate(value: string, label: string): LocalDate {
  if (!isLocalDate(value)) throw new Error(`${label} no es una fecha válida.`);
  return value;
}

export function todayDateStripDateAt(index: number, today: string): LocalDate {
  const current = checkedDate(today, 'Hoy');
  const boundedIndex = Math.max(
    0,
    Math.min(TODAY_DATE_STRIP_TODAY_INDEX, Math.trunc(index)),
  );
  return addDays(current, boundedIndex - TODAY_DATE_STRIP_TODAY_INDEX);
}

export function todayDateStripSafeSelection(
  selectedDate: string,
  today: string,
): LocalDate {
  const current = checkedDate(today, 'Hoy');
  if (!isLocalDate(selectedDate)) return current;
  if (compareDates(selectedDate, current) > 0) return current;

  const oldest = addDays(current, -TODAY_DATE_STRIP_PAST_DAYS);
  return compareDates(selectedDate, oldest) < 0 ? oldest : selectedDate;
}

export function todayDateStripIndexForDate(
  selectedDate: string,
  today: string,
): number {
  const current = checkedDate(today, 'Hoy');
  const safeSelection = todayDateStripSafeSelection(selectedDate, current);
  return TODAY_DATE_STRIP_TODAY_INDEX + daysBetween(current, safeSelection);
}
