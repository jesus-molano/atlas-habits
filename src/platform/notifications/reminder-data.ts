import { commandTargetKinds, type CommandTargetKind } from '../commands';

const DATA_KIND = 'atlas.reminder';
const DATA_VERSION = 1;

export interface ReminderNotificationData {
  readonly [key: string]: unknown;
  readonly atlasKind: typeof DATA_KIND;
  readonly atlasVersion: typeof DATA_VERSION;
  readonly reminderId: string;
  readonly targetKind: CommandTargetKind;
  readonly targetId: string;
  readonly occurrenceId: string;
  readonly snoozeMinutes: number;
}

export interface CreateReminderNotificationDataInput {
  readonly reminderId: string;
  readonly targetKind: CommandTargetKind;
  readonly targetId: string;
  readonly occurrenceId: string;
  readonly snoozeMinutes: number;
}

export function createReminderNotificationData(
  input: CreateReminderNotificationDataInput,
): ReminderNotificationData {
  if (!Number.isInteger(input.snoozeMinutes) || input.snoozeMinutes < 1) {
    throw new RangeError('snoozeMinutes must be a positive integer.');
  }

  return {
    atlasKind: DATA_KIND,
    atlasVersion: DATA_VERSION,
    reminderId: input.reminderId,
    targetKind: input.targetKind,
    targetId: input.targetId,
    occurrenceId: input.occurrenceId,
    snoozeMinutes: input.snoozeMinutes,
  };
}

export function parseReminderNotificationData(
  value: unknown,
): ReminderNotificationData | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.atlasKind !== DATA_KIND ||
    value.atlasVersion !== DATA_VERSION ||
    !isNonEmptyString(value.reminderId) ||
    !isCommandTargetKind(value.targetKind) ||
    !isNonEmptyString(value.targetId) ||
    !isNonEmptyString(value.occurrenceId) ||
    !Number.isInteger(value.snoozeMinutes) ||
    (value.snoozeMinutes as number) < 1
  ) {
    return null;
  }

  return value as unknown as ReminderNotificationData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCommandTargetKind(value: unknown): value is CommandTargetKind {
  return (
    typeof value === 'string' &&
    (commandTargetKinds as readonly string[]).includes(value)
  );
}
