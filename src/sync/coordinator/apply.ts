import { stableStringify } from '../../data/canonical-json';
import { SyncConflictError, SyncGapError, SyncIntegrityError } from '../errors';
import type { HashText } from '../hash';
import { verifySyncSegment } from '../segments';
import type {
  JsonValue,
  SyncMutationEnvelope,
  SyncSegmentEnvelope,
} from '../types';

import type {
  AppliedMutationReceipt,
  ApplyRemoteResult,
  EntityField,
  LocalApplyTransaction,
  PullChainState,
  VersionStamp,
} from './types';
import { compareVersions, newestVersion, versionFromMutation } from './version';

function emptyPullState(): PullChainState {
  return {
    cursor: { lastSeqByDevice: {} },
    lastSegmentHashByDevice: {},
    lastHlcByDevice: {},
  };
}

function clonePullState(state: PullChainState): {
  cursor: { lastSeqByDevice: Record<string, number> };
  lastSegmentHashByDevice: Record<string, string>;
  lastHlcByDevice: Record<string, string>;
} {
  return {
    cursor: { lastSeqByDevice: { ...state.cursor.lastSeqByDevice } },
    lastSegmentHashByDevice: { ...state.lastSegmentHashByDevice },
    lastHlcByDevice: { ...state.lastHlcByDevice },
  };
}

function mutationReceipt(
  mutation: SyncMutationEnvelope,
): AppliedMutationReceipt {
  return {
    mutationId: mutation.mutationId,
    deviceId: mutation.deviceId,
    seq: mutation.seq,
    hlc: mutation.hlc,
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    operation: mutation.operation,
    payloadJson: stableStringify(mutation.payload),
  };
}

function receiptsMatch(
  left: AppliedMutationReceipt,
  right: AppliedMutationReceipt,
): boolean {
  return (
    left.mutationId === right.mutationId &&
    left.deviceId === right.deviceId &&
    left.seq === right.seq &&
    left.hlc === right.hlc &&
    left.entityType === right.entityType &&
    left.entityId === right.entityId &&
    left.operation === right.operation &&
    left.payloadJson === right.payloadJson
  );
}

function objectFields(payload: JsonValue, mutationId: string): EntityField[] {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new SyncIntegrityError(
      `Upsert mutation ${mutationId} must contain an object payload.`,
    );
  }
  const fields = Object.entries(payload).map(([name, value]) => ({
    name,
    value,
  }));
  if (fields.length === 0) {
    throw new SyncIntegrityError(
      `Upsert mutation ${mutationId} has an empty payload.`,
    );
  }
  return fields;
}

function fieldBaseVersion(
  fieldName: string,
  fieldVersions: Readonly<Record<string, VersionStamp>>,
  wildcardVersion: VersionStamp | null,
): VersionStamp | null {
  return newestVersion([fieldVersions[fieldName], wildcardVersion]);
}

type ApplyCounters = {
  appliedMutations: number;
  duplicateMutations: number;
  ignoredConflicts: number;
};

async function applyMutation(
  transaction: LocalApplyTransaction,
  mutation: SyncMutationEnvelope,
  appliedAt: number,
  counters: ApplyCounters,
  ignoreMaterialization: boolean,
): Promise<void> {
  const incomingReceipt = mutationReceipt(mutation);
  const receipt = await transaction.getAppliedMutation(mutation.mutationId);
  if (receipt) {
    if (!receiptsMatch(receipt, incomingReceipt)) {
      throw new SyncConflictError(
        `Mutation ID ${mutation.mutationId} was reused with different content.`,
      );
    }
    counters.duplicateMutations += 1;
    await transaction.observeRemoteHlc(mutation.hlc, appliedAt);
    return;
  }

  if (ignoreMaterialization) {
    await transaction.recordAppliedMutation(incomingReceipt, appliedAt);
    await transaction.observeRemoteHlc(mutation.hlc, appliedAt);
    return;
  }

  const incomingVersion = versionFromMutation(mutation);
  const metadata = await transaction.getEntityMetadata(
    mutation.entityType,
    mutation.entityId,
  );
  let applied = false;

  if (mutation.operation === 'delete') {
    const newestLiveVersion = newestVersion([
      metadata.wildcardVersion,
      ...Object.values(metadata.fieldVersions),
    ]);
    const winningVersion = newestVersion([
      newestLiveVersion,
      metadata.tombstone,
    ]);
    if (
      !winningVersion ||
      compareVersions(incomingVersion, winningVersion) >= 0
    ) {
      await transaction.deleteEntity(mutation);
      await transaction.setTombstone(
        mutation.entityType,
        mutation.entityId,
        incomingVersion,
        appliedAt,
      );
      applied = true;
    }
  } else if (
    !metadata.tombstone ||
    compareVersions(incomingVersion, metadata.tombstone) > 0
  ) {
    const acceptedFields = objectFields(
      mutation.payload,
      mutation.mutationId,
    ).filter((field) => {
      const existing = fieldBaseVersion(
        field.name,
        metadata.fieldVersions,
        metadata.wildcardVersion,
      );
      return !existing || compareVersions(incomingVersion, existing) > 0;
    });
    if (acceptedFields.length > 0) {
      await transaction.upsertEntityFields(mutation, acceptedFields);
      for (const field of acceptedFields) {
        await transaction.setFieldVersion(
          mutation.entityType,
          mutation.entityId,
          field.name,
          incomingVersion,
          appliedAt,
        );
      }
      if (metadata.tombstone) {
        await transaction.clearTombstone(
          mutation.entityType,
          mutation.entityId,
        );
      }
      applied = true;
    }
  }

  if (applied) counters.appliedMutations += 1;
  else counters.ignoredConflicts += 1;
  await transaction.recordAppliedMutation(incomingReceipt, appliedAt);
  await transaction.observeRemoteHlc(mutation.hlc, appliedAt);
}

function sortedSegments(
  segments: readonly SyncSegmentEnvelope[],
): SyncSegmentEnvelope[] {
  return [...segments].sort(
    (left, right) =>
      left.deviceId.localeCompare(right.deviceId) ||
      left.firstSeq - right.firstSeq,
  );
}

function validateNextSegment(
  segment: SyncSegmentEnvelope,
  state: ReturnType<typeof clonePullState>,
): void {
  const appliedThrough = state.cursor.lastSeqByDevice[segment.deviceId] ?? 0;
  if (segment.firstSeq !== appliedThrough + 1) {
    throw new SyncGapError(
      segment.deviceId,
      appliedThrough + 1,
      segment.firstSeq,
    );
  }
  const expectedPreviousHash =
    appliedThrough === 0
      ? null
      : state.lastSegmentHashByDevice[segment.deviceId];
  if (appliedThrough > 0 && !expectedPreviousHash) {
    throw new SyncIntegrityError(
      `Missing local hash-chain anchor for ${segment.deviceId} at sequence ${appliedThrough}.`,
    );
  }
  if (segment.previousSegmentHash !== expectedPreviousHash) {
    throw new SyncConflictError(
      `Segment ${segment.deviceId}/${segment.segmentId} does not continue the local hash chain.`,
    );
  }

  let previousHlc = state.lastHlcByDevice[segment.deviceId] ?? null;
  for (const mutation of segment.operations) {
    const version = versionFromMutation(mutation);
    if (previousHlc) {
      const prior: VersionStamp = {
        hlc: previousHlc,
        deviceId: segment.deviceId,
        operation: 'upsert',
      };
      if (compareVersions(version, prior) <= 0) {
        throw new SyncIntegrityError(
          `HLC order regressed at ${mutation.mutationId} for ${segment.deviceId}.`,
        );
      }
    }
    previousHlc = mutation.hlc;
  }
}

export type ApplyRemoteSegmentsOptions = Readonly<{
  remoteId: string;
  segments: readonly SyncSegmentEnvelope[];
  hashText: HashText;
  appliedAt: number;
  /** Device histories that must advance the chain without replaying local writes. */
  ignoredDeviceIds?: ReadonlySet<string>;
  runTransaction<T>(
    work: (transaction: LocalApplyTransaction) => Promise<T>,
  ): Promise<T>;
}>;

/** Verify first, then materialize mutations and advance the cursor atomically. */
export async function applyRemoteSegments(
  options: ApplyRemoteSegmentsOptions,
): Promise<ApplyRemoteResult> {
  await Promise.all(
    options.segments.map((segment) =>
      verifySyncSegment(segment, options.hashText),
    ),
  );
  const ordered = sortedSegments(options.segments);

  return options.runTransaction(async (transaction) => {
    const persisted =
      (await transaction.getPullState(options.remoteId)) ?? emptyPullState();
    const next = clonePullState(persisted);
    const counters: ApplyCounters = {
      appliedMutations: 0,
      duplicateMutations: 0,
      ignoredConflicts: 0,
    };
    let acceptedSegments = 0;
    const accepted: SyncSegmentEnvelope[] = [];

    for (const segment of ordered) {
      const appliedThrough = next.cursor.lastSeqByDevice[segment.deviceId] ?? 0;
      if (segment.lastSeq <= appliedThrough) continue;
      if (segment.firstSeq <= appliedThrough) {
        throw new SyncIntegrityError(
          `Segment ${segment.deviceId}/${segment.segmentId} overlaps a committed segment boundary.`,
        );
      }
      validateNextSegment(segment, next);
      next.cursor.lastSeqByDevice[segment.deviceId] = segment.lastSeq;
      next.lastSegmentHashByDevice[segment.deviceId] = segment.contentHash;
      next.lastHlcByDevice[segment.deviceId] =
        segment.operations[segment.operations.length - 1].hlc;
      accepted.push(segment);
      acceptedSegments += 1;
    }

    // A mutation on device B can depend on an entity that B previously pulled
    // from device A. Device-id ordering alone can therefore place a child
    // before its causal parent on a third device. HLC ordering preserves that
    // dependency while the per-device validation above still protects every
    // immutable sequence and hash chain.
    const mutations = accepted
      .flatMap((segment) => [...segment.operations])
      .sort((left, right) =>
        compareVersions(versionFromMutation(left), versionFromMutation(right)),
      );
    for (const mutation of mutations) {
      await applyMutation(
        transaction,
        mutation,
        options.appliedAt,
        counters,
        options.ignoredDeviceIds?.has(mutation.deviceId) ?? false,
      );
    }

    const frozenState: PullChainState = {
      cursor: { lastSeqByDevice: { ...next.cursor.lastSeqByDevice } },
      lastSegmentHashByDevice: { ...next.lastSegmentHashByDevice },
      lastHlcByDevice: { ...next.lastHlcByDevice },
    };
    if (acceptedSegments > 0) {
      await transaction.setPullState(
        options.remoteId,
        frozenState,
        options.appliedAt,
      );
    }
    return {
      segments: acceptedSegments,
      ...counters,
      state: frozenState,
    };
  });
}
