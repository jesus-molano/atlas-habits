import { SyncIntegrityError } from './errors';
import type {
  JsonValue,
  SyncCursor,
  SyncMutationEnvelope,
  SyncSegmentEnvelope,
} from './types';

const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const SEGMENT_ID_PATTERN = /^\d{16}$/;

function requireNonEmptyString(
  value: unknown,
  label: string,
  maxLength = 512,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new SyncIntegrityError(
      `${label} must be a non-empty string of at most ${maxLength} characters.`,
    );
  }
}

export function assertDeviceId(
  value: unknown,
  label = 'deviceId',
): asserts value is string {
  if (typeof value !== 'string' || !DEVICE_ID_PATTERN.test(value)) {
    throw new SyncIntegrityError(
      `${label} must contain only letters, numbers, dots, underscores, or hyphens.`,
    );
  }
}

export function assertSequence(
  value: unknown,
  label: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new SyncIntegrityError(`${label} must be a positive safe integer.`);
  }
}

export function assertHash(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new SyncIntegrityError(`${label} must be a lowercase SHA-256 hash.`);
  }
}

export function assertJsonValue(
  value: unknown,
  label = 'payload',
): asserts value is JsonValue {
  const ancestors = new Set<object>();

  const visit = (entry: unknown, path: string, depth: number): void => {
    if (depth > 64)
      throw new SyncIntegrityError(`${path} exceeds the maximum JSON depth.`);
    if (
      entry === null ||
      typeof entry === 'string' ||
      typeof entry === 'boolean'
    )
      return;
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry))
        throw new SyncIntegrityError(`${path} must be a finite number.`);
      return;
    }
    if (typeof entry !== 'object') {
      throw new SyncIntegrityError(
        `${path} contains a value that JSON cannot represent.`,
      );
    }
    if (ancestors.has(entry))
      throw new SyncIntegrityError(`${path} contains a circular reference.`);

    const prototype = Object.getPrototypeOf(entry);
    if (
      !Array.isArray(entry) &&
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      throw new SyncIntegrityError(
        `${path} must contain only JSON objects and arrays.`,
      );
    }

    ancestors.add(entry);
    if (Array.isArray(entry)) {
      entry.forEach((child, index) =>
        visit(child, `${path}[${index}]`, depth + 1),
      );
    } else {
      for (const [key, child] of Object.entries(entry)) {
        visit(child, `${path}.${key}`, depth + 1);
      }
    }
    ancestors.delete(entry);
  };

  visit(value, label, 0);
}

export function assertMutationEnvelope(
  value: unknown,
): asserts value is SyncMutationEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SyncIntegrityError('A sync mutation must be an object.');
  }
  const mutation = value as Record<string, unknown>;
  if (mutation.schemaVersion !== 1)
    throw new SyncIntegrityError('Unsupported mutation schema.');
  requireNonEmptyString(mutation.mutationId, 'mutationId');
  assertDeviceId(mutation.deviceId);
  assertSequence(mutation.seq, 'seq');
  requireNonEmptyString(mutation.hlc, 'hlc');
  requireNonEmptyString(mutation.entityType, 'entityType', 128);
  requireNonEmptyString(mutation.entityId, 'entityId');
  if (mutation.operation !== 'upsert' && mutation.operation !== 'delete') {
    throw new SyncIntegrityError('operation must be upsert or delete.');
  }
  assertJsonValue(mutation.payload);
}

export function makeSegmentId(firstSeq: number, lastSeq: number): string {
  assertSequence(firstSeq, 'firstSeq');
  assertSequence(lastSeq, 'lastSeq');
  if (lastSeq < firstSeq)
    throw new SyncIntegrityError('lastSeq must not precede firstSeq.');
  // The first sequence is a stable collision key. If a retry changes a
  // segment boundary, create-only upload reports a conflict instead of
  // accepting overlapping immutable ranges.
  return firstSeq.toString().padStart(16, '0');
}

export function assertSegmentEnvelopeShape(
  value: unknown,
): asserts value is SyncSegmentEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SyncIntegrityError('A sync segment must be an object.');
  }
  const segment = value as Record<string, unknown>;
  if (segment.schemaVersion !== 1)
    throw new SyncIntegrityError('Unsupported segment schema.');
  if (
    typeof segment.segmentId !== 'string' ||
    !SEGMENT_ID_PATTERN.test(segment.segmentId)
  ) {
    throw new SyncIntegrityError('Invalid segmentId.');
  }
  assertDeviceId(segment.deviceId);
  assertSequence(segment.firstSeq, 'firstSeq');
  assertSequence(segment.lastSeq, 'lastSeq');
  assertSequence(segment.operationCount, 'operationCount');
  if (segment.previousSegmentHash !== null) {
    assertHash(segment.previousSegmentHash, 'previousSegmentHash');
  }
  assertHash(segment.contentHash, 'contentHash');
  if (!Array.isArray(segment.operations)) {
    throw new SyncIntegrityError('Segment operations must be an array.');
  }
  if (segment.operations.length !== segment.operationCount) {
    throw new SyncIntegrityError(
      'Segment operationCount does not match its operations.',
    );
  }
  if (
    segment.segmentId !==
    makeSegmentId(segment.firstSeq as number, segment.lastSeq as number)
  ) {
    throw new SyncIntegrityError(
      'Segment ID does not match its sequence range.',
    );
  }

  let expected = segment.firstSeq as number;
  for (const operation of segment.operations) {
    assertMutationEnvelope(operation);
    if (operation.deviceId !== segment.deviceId) {
      throw new SyncIntegrityError(
        'A segment contains an operation from another device.',
      );
    }
    if (operation.seq !== expected) {
      throw new SyncIntegrityError(
        `Segment sequence is not contiguous at ${operation.seq}.`,
      );
    }
    expected += 1;
  }
  if (expected - 1 !== segment.lastSeq) {
    throw new SyncIntegrityError(
      'Segment sequence range does not match its operations.',
    );
  }
}

export function normalizeCursor(cursor: SyncCursor): Record<string, number> {
  if (
    typeof cursor !== 'object' ||
    cursor === null ||
    typeof cursor.lastSeqByDevice !== 'object'
  ) {
    throw new SyncIntegrityError('Invalid sync cursor.');
  }

  const normalized: Record<string, number> = {};
  for (const [deviceId, seq] of Object.entries(cursor.lastSeqByDevice)) {
    assertDeviceId(deviceId, 'cursor deviceId');
    if (!Number.isSafeInteger(seq) || seq < 0) {
      throw new SyncIntegrityError(
        `Cursor for ${deviceId} must be a non-negative safe integer.`,
      );
    }
    normalized[deviceId] = seq;
  }
  return normalized;
}
