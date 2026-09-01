function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

/**
 * Keeps the current seven-day window stable for recent dates. Older calendar
 * selections get a centered window so the active day is never off-screen.
 */
export function todayDateStripKeys(
  selectedDate: string,
  today = new Date(),
): string[] {
  const current = new Date(today);
  current.setHours(12, 0, 0, 0);
  const currentKey = dateKey(current);
  const safeSelectedKey = selectedDate > currentKey ? currentKey : selectedDate;
  const selected = parseDate(safeSelectedKey);
  const recentStart = addDays(current, -6);
  const selectedIsRecent = selected >= recentStart;
  const end = selectedIsRecent ? current : addDays(selected, 3);
  const start = addDays(end, -6);

  return Array.from({ length: 7 }, (_, index) =>
    dateKey(addDays(start, index)),
  );
}
