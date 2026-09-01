export const DURATION_WHEEL_MAX_HOURS = 12;
export const DURATION_WHEEL_MAX_MINUTES = 59;
export const DURATION_WHEEL_MAX_SECONDS = 59;
export const DURATION_WHEEL_MAX_SECONDS_TOTAL =
  DURATION_WHEEL_MAX_HOURS * 3_600;

export type DurationWheelParts = Readonly<{
  hours: number;
  minutes: number;
  seconds: number;
}>;

export type DurationWheelUnit = 'hours' | 'minutes' | 'seconds';

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clampDurationSeconds(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp(Math.round(value), 0, DURATION_WHEEL_MAX_SECONDS_TOTAL);
}

export function durationWheelParts(value: number): DurationWheelParts {
  const totalSeconds = clampDurationSeconds(value);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return { hours, minutes, seconds };
}

/**
 * The picker supports a maximum of exactly 12:00:00. At twelve hours the
 * minute and second wheels must only expose zero, not values that would be
 * clamped invisibly by the controlled value.
 */
export function durationWheelColumnMaximum(
  unit: DurationWheelUnit,
  hours: number,
): number {
  if (unit === 'hours') return DURATION_WHEEL_MAX_HOURS;
  if (Math.round(hours) >= DURATION_WHEEL_MAX_HOURS) return 0;
  return unit === 'minutes'
    ? DURATION_WHEEL_MAX_MINUTES
    : DURATION_WHEEL_MAX_SECONDS;
}

export function durationWheelSeconds({
  hours,
  minutes,
  seconds,
}: DurationWheelParts): number {
  const safeHours = clamp(Math.round(hours), 0, DURATION_WHEEL_MAX_HOURS);
  const safeMinutes = clamp(Math.round(minutes), 0, DURATION_WHEEL_MAX_MINUTES);
  const safeSeconds = clamp(Math.round(seconds), 0, DURATION_WHEEL_MAX_SECONDS);
  return clampDurationSeconds(
    safeHours * 3_600 + safeMinutes * 60 + safeSeconds,
  );
}

export function wheelIndexFromOffset(
  offsetY: number,
  rowHeight: number,
  maximumIndex: number,
): number {
  if (
    !Number.isFinite(offsetY) ||
    !Number.isFinite(rowHeight) ||
    rowHeight <= 0
  ) {
    return 0;
  }
  return clamp(Math.round(offsetY / rowHeight), 0, maximumIndex);
}

export function durationWheelText(parts: DurationWheelParts): string {
  const value = durationWheelParts(durationWheelSeconds(parts));
  const hours = `${value.hours} ${value.hours === 1 ? 'hora' : 'horas'}`;
  const minutes = `${value.minutes} ${value.minutes === 1 ? 'minuto' : 'minutos'}`;
  const seconds = `${value.seconds} ${value.seconds === 1 ? 'segundo' : 'segundos'}`;
  return `${hours}, ${minutes} y ${seconds}`;
}
