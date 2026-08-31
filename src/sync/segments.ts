import { stableStringify } from '../data/canonical-json';

import { SyncIntegrityError } from './errors';
import { sha256Hex, type HashText } from './hash';
import type { SyncMutationEnvelope, SyncSegmentEnvelope } from './types';
import {
  assertHash,
  assertMutationEnvelope,
  assertSegmentEnvelopeShape,
  makeSegmentId,
} from './validation';

export const DEFAULT_SEGMENT_LIMITS = Object.freeze({
  maxOperations: 100,
  // Leaves headroom below Firestore's 1 MiB document limit and the rule limit.
  maxPayloadBytes: 700 * 1024,
});

export type SegmentLimits = Readonly<{
  maxOperations: number;
  maxPayloadBytes: number;
}>;

export type BuildSegmentsOptions = Readonly<{
  previousSegmentHash?: string | null;
  limits?: Partial<SegmentLimits>;
  hashText?: HashText;
}>;

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint < 0x80) bytes += 1;
    else if (codePoint < 0x800) bytes += 2;
    else if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        bytes += 4;
      } else {
        // JSON.stringify preserves an unpaired surrogate as an ASCII escape.
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

export function segmentPayloadBytes(
  operations: readonly SyncMutationEnvelope[],
): number {
  return utf8ByteLength(stableStringify(operations));
}

function normalizeLimits(limits?: Partial<SegmentLimits>): SegmentLimits {
  const normalized = {
    maxOperations:
      limits?.maxOperations ?? DEFAULT_SEGMENT_LIMITS.maxOperations,
    maxPayloadBytes:
      limits?.maxPayloadBytes ?? DEFAULT_SEGMENT_LIMITS.maxPayloadBytes,
  };
  if (
    !Number.isSafeInteger(normalized.maxOperations) ||
    normalized.maxOperations < 1
  ) {
    throw new SyncIntegrityError('maxOperations must be a positive integer.');
  }
  if (
    !Number.isSafeInteger(normalized.maxPayloadBytes) ||
    normalized.maxPayloadBytes < 256
  ) {
    throw new SyncIntegrityError(
      'maxPayloadBytes must be an integer of at least 256 bytes.',
    );
  }
  return normalized;
}

function assertOrderedOperations(
  operations: readonly SyncMutationEnvelope[],
): void {
  if (operations.length === 0) return;
  const deviceId = operations[0].deviceId;
  let expectedSeq = operations[0].seq;
  for (const operation of operations) {
    assertMutationEnvelope(operation);
    if (operation.deviceId !== deviceId) {
      throw new SyncIntegrityError(
        'All operations in a segment build must use the same deviceId.',
      );
    }
    if (operation.seq !== expectedSeq) {
      throw new SyncIntegrityError(
        `Operations must have contiguous device sequences; expected ${expectedSeq}, received ${operation.seq}.`,
      );
    }
    expectedSeq += 1;
  }
}

/** Pure deterministic partitioning by operation count and canonical JSON bytes. */
export function partitionMutations(
  operations: readonly SyncMutationEnvelope[],
  limits?: Partial<SegmentLimits>,
): readonly (readonly SyncMutationEnvelope[])[] {
  assertOrderedOperations(operations);
  if (operations.length === 0) return [];
  const resolved = normalizeLimits(limits);
  const partitions: SyncMutationEnvelope[][] = [];
  let current: SyncMutationEnvelope[] = [];

  for (const operation of operations) {
    const candidate = [...current, operation];
    const candidateFits =
      candidate.length <= resolved.maxOperations &&
      segmentPayloadBytes(candidate) <= resolved.maxPayloadBytes;

    if (candidateFits) {
      current = candidate;
      continue;
    }
    if (current.length === 0) {
      throw new SyncIntegrityError(
        `Mutation ${operation.mutationId} exceeds the configured segment payload limit.`,
      );
    }
    partitions.push(current);
    current = [operation];
    if (segmentPayloadBytes(current) > resolved.maxPayloadBytes) {
      throw new SyncIntegrityError(
        `Mutation ${operation.mutationId} exceeds the configured segment payload limit.`,
      );
    }
  }
  if (current.length > 0) partitions.push(current);
  return partitions;
}

export function segmentHashInput(
  segment: Pick<
    SyncSegmentEnvelope,
    | 'schemaVersion'
    | 'deviceId'
    | 'firstSeq'
    | 'lastSeq'
    | 'previousSegmentHash'
    | 'operations'
  >,
): string {
  return stableStringify({
    schemaVersion: segment.schemaVersion,
    deviceId: segment.deviceId,
    firstSeq: segment.firstSeq,
    lastSeq: segment.lastSeq,
    previousSegmentHash: segment.previousSegmentHash,
    operations: segment.operations,
  });
}

export async function buildSyncSegments(
  operations: readonly SyncMutationEnvelope[],
  options: BuildSegmentsOptions = {},
): Promise<readonly SyncSegmentEnvelope[]> {
  if (
    options.previousSegmentHash !== undefined &&
    options.previousSegmentHash !== null
  ) {
    assertHash(options.previousSegmentHash, 'previousSegmentHash');
  }
  const partitions = partitionMutations(operations, options.limits);
  const hashText = options.hashText ?? sha256Hex;
  const segments: SyncSegmentEnvelope[] = [];
  let previousSegmentHash = options.previousSegmentHash ?? null;

  for (const partition of partitions) {
    const firstSeq = partition[0].seq;
    const lastSeq = partition[partition.length - 1].seq;
    const body = {
      schemaVersion: 1 as const,
      deviceId: partition[0].deviceId,
      firstSeq,
      lastSeq,
      previousSegmentHash,
      operations: partition,
    };
    const contentHash = (await hashText(segmentHashInput(body))).toLowerCase();
    assertHash(contentHash, 'generated contentHash');
    const segment: SyncSegmentEnvelope = {
      ...body,
      segmentId: makeSegmentId(firstSeq, lastSeq),
      operationCount: partition.length,
      contentHash,
    };
    segments.push(segment);
    previousSegmentHash = contentHash;
  }
  return segments;
}

export async function verifySyncSegment(
  segment: SyncSegmentEnvelope,
  hashText: HashText = sha256Hex,
): Promise<void> {
  assertSegmentEnvelopeShape(segment);
  const calculated = (await hashText(segmentHashInput(segment))).toLowerCase();
  assertHash(calculated, 'calculated contentHash');
  if (calculated !== segment.contentHash) {
    throw new SyncIntegrityError(
      `Content hash mismatch for segment ${segment.segmentId}.`,
    );
  }
}

export function assertSegmentChain(
  segments: readonly SyncSegmentEnvelope[],
): void {
  const byDevice = new Map<string, SyncSegmentEnvelope[]>();
  for (const segment of segments) {
    assertSegmentEnvelopeShape(segment);
    const existing = byDevice.get(segment.deviceId) ?? [];
    existing.push(segment);
    byDevice.set(segment.deviceId, existing);
  }

  for (const deviceSegments of byDevice.values()) {
    deviceSegments.sort((left, right) => left.firstSeq - right.firstSeq);
    for (let index = 1; index < deviceSegments.length; index += 1) {
      const previous = deviceSegments[index - 1];
      const current = deviceSegments[index];
      if (current.firstSeq !== previous.lastSeq + 1) {
        throw new SyncIntegrityError(
          `Non-contiguous segment chain for ${current.deviceId}.`,
        );
      }
      if (current.previousSegmentHash !== previous.contentHash) {
        throw new SyncIntegrityError(
          `Broken segment hash chain for ${current.deviceId}.`,
        );
      }
    }
  }
}
