import { SyncConflictError, SyncGapError } from './errors';
import type { SyncCursor, SyncPullResult, SyncSegmentEnvelope } from './types';
import { assertSegmentEnvelopeShape, normalizeCursor } from './validation';

/**
 * Pure merge for already integrity-checked transport envelopes.
 *
 * Segments at or before the vector are discarded. An overlapping segment is
 * retained so the SQLite applier can replay it idempotently by mutation ID.
 */
export function mergePullEnvelope(
  cursor: SyncCursor,
  incoming: readonly SyncSegmentEnvelope[],
  hasMoreByDevice: Readonly<Record<string, boolean>> = {},
): SyncPullResult {
  const nextVector = normalizeCursor(cursor);
  const unique = new Map<string, SyncSegmentEnvelope>();

  for (const segment of incoming) {
    assertSegmentEnvelopeShape(segment);
    const key = `${segment.deviceId}/${segment.segmentId}`;
    const previous = unique.get(key);
    if (previous && previous.contentHash !== segment.contentHash) {
      throw new SyncConflictError(
        `Conflicting copies of immutable segment ${key}.`,
      );
    }
    unique.set(key, segment);
  }

  const sorted = [...unique.values()].sort(
    (left, right) =>
      left.deviceId.localeCompare(right.deviceId) ||
      left.firstSeq - right.firstSeq ||
      left.lastSeq - right.lastSeq,
  );
  const accepted: SyncSegmentEnvelope[] = [];
  const previousAcceptedByDevice = new Map<string, SyncSegmentEnvelope>();

  for (const segment of sorted) {
    const appliedThrough = nextVector[segment.deviceId] ?? 0;
    if (segment.lastSeq <= appliedThrough) continue;
    if (segment.firstSeq > appliedThrough + 1) {
      throw new SyncGapError(
        segment.deviceId,
        appliedThrough + 1,
        segment.firstSeq,
      );
    }
    const previous = previousAcceptedByDevice.get(segment.deviceId);
    if (previous && segment.previousSegmentHash !== previous.contentHash) {
      throw new SyncConflictError(
        `Broken immutable segment hash chain for ${segment.deviceId}.`,
      );
    }
    if (
      !previous &&
      appliedThrough === 0 &&
      segment.previousSegmentHash !== null
    ) {
      throw new SyncConflictError(
        `The first segment for ${segment.deviceId} does not start a hash chain.`,
      );
    }
    accepted.push(segment);
    previousAcceptedByDevice.set(segment.deviceId, segment);
    nextVector[segment.deviceId] = Math.max(appliedThrough, segment.lastSeq);
  }

  const normalizedMore: Record<string, boolean> = {};
  for (const [deviceId, hasMore] of Object.entries(hasMoreByDevice)) {
    if (hasMore) normalizedMore[deviceId] = true;
  }

  return {
    segments: accepted,
    cursor: { lastSeqByDevice: nextVector },
    hasMoreByDevice: normalizedMore,
  };
}
