/**
 * Commands emitted by platform entry points (notifications and Android widgets).
 *
 * The application layer owns the concrete gateway. It must persist an
 * idempotency key atomically with the state change so Android can safely retry a
 * headless task without applying the same command twice.
 */

export const commandTargetKinds = ['habit', 'task', 'routine-step'] as const;

export type CommandTargetKind = (typeof commandTargetKinds)[number];
export type CommandSource = 'notification' | 'widget';

export interface CompleteOccurrenceCommand {
  readonly type: 'occurrence.complete';
  readonly targetKind: CommandTargetKind;
  readonly targetId: string;
  readonly occurrenceId: string;
  /** A set operation is safe to retry. Do not replace this with a toggle. */
  readonly completed: true;
}

export interface SnoozeReminderCommand {
  readonly type: 'reminder.snooze';
  readonly reminderId: string;
  readonly targetKind: CommandTargetKind;
  readonly targetId: string;
  readonly occurrenceId: string;
  readonly sourceNotificationId: string;
  readonly snoozeUntil: string;
}

export type AtlasCommand = CompleteOccurrenceCommand | SnoozeReminderCommand;

export interface CommandEnvelope<TCommand extends AtlasCommand = AtlasCommand> {
  readonly command: TCommand;
  /**
   * Stable across retries and across platform surfaces that represent the same
   * user intent.
   */
  readonly idempotencyKey: string;
  readonly source: CommandSource;
  readonly issuedAt: string;
}

export type CommandDispatchStatus = 'applied' | 'duplicate';

export interface CommandDispatchResult {
  readonly status: CommandDispatchStatus;
}

export interface CommandGateway {
  /**
   * Applies a command at most once for a given idempotency key.
   *
   * Implementations should enforce this in the same SQLite transaction as the
   * state mutation; an in-memory de-duplication set is not sufficient.
   */
  dispatch(envelope: CommandEnvelope): Promise<CommandDispatchResult>;
}

export interface CompleteOccurrenceInput {
  readonly targetKind: CommandTargetKind;
  readonly targetId: string;
  readonly occurrenceId: string;
  readonly source: CommandSource;
  readonly issuedAt: Date;
}

export interface SnoozeReminderInput {
  readonly reminderId: string;
  readonly targetKind: CommandTargetKind;
  readonly targetId: string;
  readonly occurrenceId: string;
  readonly sourceNotificationId: string;
  readonly snoozeMinutes: number;
  readonly source: CommandSource;
  readonly issuedAt: Date;
}

export function createCompleteOccurrenceEnvelope(
  input: CompleteOccurrenceInput,
): CommandEnvelope<CompleteOccurrenceCommand> {
  assertNonEmpty(input.targetId, 'targetId');
  assertNonEmpty(input.occurrenceId, 'occurrenceId');

  return {
    command: {
      type: 'occurrence.complete',
      targetKind: input.targetKind,
      targetId: input.targetId,
      occurrenceId: input.occurrenceId,
      completed: true,
    },
    idempotencyKey: key(
      'occurrence.complete',
      input.targetKind,
      input.targetId,
      input.occurrenceId,
    ),
    source: input.source,
    issuedAt: input.issuedAt.toISOString(),
  };
}

export function createSnoozeReminderEnvelope(
  input: SnoozeReminderInput,
): CommandEnvelope<SnoozeReminderCommand> {
  assertNonEmpty(input.reminderId, 'reminderId');
  assertNonEmpty(input.targetId, 'targetId');
  assertNonEmpty(input.occurrenceId, 'occurrenceId');
  assertNonEmpty(input.sourceNotificationId, 'sourceNotificationId');

  if (!Number.isInteger(input.snoozeMinutes) || input.snoozeMinutes < 1) {
    throw new RangeError('snoozeMinutes must be a positive integer.');
  }

  const snoozeUntil = new Date(
    input.issuedAt.getTime() + input.snoozeMinutes * 60_000,
  );

  return {
    command: {
      type: 'reminder.snooze',
      reminderId: input.reminderId,
      targetKind: input.targetKind,
      targetId: input.targetId,
      occurrenceId: input.occurrenceId,
      sourceNotificationId: input.sourceNotificationId,
      snoozeUntil: snoozeUntil.toISOString(),
    },
    idempotencyKey: key(
      'reminder.snooze',
      input.reminderId,
      input.sourceNotificationId,
      String(input.snoozeMinutes),
    ),
    source: input.source,
    issuedAt: input.issuedAt.toISOString(),
  };
}

export async function dispatchCompleteOccurrence(
  gateway: CommandGateway,
  input: CompleteOccurrenceInput,
): Promise<CommandDispatchResult> {
  return gateway.dispatch(createCompleteOccurrenceEnvelope(input));
}

export async function dispatchSnoozeReminder(
  gateway: CommandGateway,
  input: SnoozeReminderInput,
): Promise<CommandDispatchResult> {
  return gateway.dispatch(createSnoozeReminderEnvelope(input));
}

function key(...parts: string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join(':');
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${field} must not be empty.`);
  }
}
