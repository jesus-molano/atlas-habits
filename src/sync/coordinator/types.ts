import type { HashText } from '../hash';
import type { SegmentLimits } from '../segments';
import type {
  JsonValue,
  SyncCursor,
  SyncMutationEnvelope,
  SyncTransport,
} from '../types';

export type VersionOperation = 'upsert' | 'delete';

export type VersionStamp = Readonly<{
  hlc: string;
  deviceId: string;
  operation: VersionOperation;
}>;

export type EntitySyncMetadata = Readonly<{
  exists: boolean;
  /** Fallback created by local mutations that clock the whole payload as `*`. */
  wildcardVersion: VersionStamp | null;
  fieldVersions: Readonly<Record<string, VersionStamp>>;
  tombstone: VersionStamp | null;
}>;

export type AppliedMutationReceipt = Readonly<{
  mutationId: string;
  deviceId: string;
  seq: number;
  hlc: string;
  entityType: string;
  entityId: string;
  operation: VersionOperation;
  /** Canonical JSON. It prevents mutation-id reuse with different content. */
  payloadJson: string;
}>;

export type PullChainState = Readonly<{
  cursor: SyncCursor;
  lastSegmentHashByDevice: Readonly<Record<string, string>>;
  lastHlcByDevice: Readonly<Record<string, string>>;
}>;

export type UploadChainState = Readonly<{
  lastSeq: number;
  lastSegmentHash: string | null;
  lastHlc: string | null;
}>;

export type EntityField = Readonly<{ name: string; value: JsonValue }>;

/** All methods are called inside the same SQLite write transaction. */
export interface LocalApplyTransaction {
  getPullState(remoteId: string): Promise<PullChainState>;
  setPullState(
    remoteId: string,
    state: PullChainState,
    appliedAt: number,
  ): Promise<void>;

  getAppliedMutation(
    mutationId: string,
  ): Promise<AppliedMutationReceipt | null>;
  recordAppliedMutation(
    receipt: AppliedMutationReceipt,
    appliedAt: number,
  ): Promise<void>;

  getEntityMetadata(
    entityType: string,
    entityId: string,
  ): Promise<EntitySyncMetadata>;
  upsertEntityFields(
    mutation: SyncMutationEnvelope,
    fields: readonly EntityField[],
  ): Promise<void>;
  deleteEntity(mutation: SyncMutationEnvelope): Promise<void>;
  setFieldVersion(
    entityType: string,
    entityId: string,
    fieldName: string,
    version: VersionStamp,
    appliedAt: number,
  ): Promise<void>;
  setTombstone(
    entityType: string,
    entityId: string,
    version: VersionStamp,
    appliedAt: number,
  ): Promise<void>;
  clearTombstone(entityType: string, entityId: string): Promise<void>;
  observeRemoteHlc(hlc: string, observedAt: number): Promise<void>;
}

/**
 * Provider-neutral local seam. Its transaction must roll back entity writes,
 * mutation receipts and the pull cursor together.
 */
export interface CoordinatorLocalStore {
  getLocalSequence(deviceId: string): Promise<number>;
  listLocalMutationsAfter(
    deviceId: string,
    sequenceExclusive: number,
    limit: number,
  ): Promise<readonly SyncMutationEnvelope[]>;

  getUploadState(remoteId: string, deviceId: string): Promise<UploadChainState>;
  commitUpload(
    input: Readonly<{
      remoteId: string;
      deviceId: string;
      expectedPrevious: UploadChainState;
      next: UploadChainState;
      mutationIds: readonly string[];
      uploadedAt: number;
    }>,
  ): Promise<void>;
  markUploadFailed(
    mutationIds: readonly string[],
    message: string,
    failedAt: number,
  ): Promise<void>;

  runApplyTransaction<T>(
    work: (transaction: LocalApplyTransaction) => Promise<T>,
  ): Promise<T>;
  persistCoordinatorState?(
    remoteId: string,
    state: SyncCoordinatorState,
  ): Promise<void>;
}

export type SyncTrigger =
  'manual' | 'app_start' | 'foreground' | 'local_change' | 'retry';

export type SyncErrorCode =
  | 'authentication'
  | 'conflict'
  | 'gap'
  | 'integrity'
  | 'local'
  | 'transport'
  | 'unexpected';

export type SyncFailure = Readonly<{
  code: SyncErrorCode;
  message: string;
  retriable: boolean;
  occurredAt: number;
  cause?: unknown;
}>;

export type SyncPhase =
  'disabled' | 'idle' | 'syncing' | 'waiting_retry' | 'failed';

export type SyncCoordinatorState = Readonly<{
  phase: SyncPhase;
  trigger: SyncTrigger | null;
  attempt: number;
  startedAt: number | null;
  lastSucceededAt: number | null;
  nextRetryAt: number | null;
  error: SyncFailure | null;
}>;

export type SyncRunSummary = Readonly<{
  trigger: SyncTrigger;
  startedAt: number;
  finishedAt: number;
  uploadedOperations: number;
  uploadedSegments: number;
  downloadedSegments: number;
  appliedMutations: number;
  duplicateMutations: number;
  ignoredConflicts: number;
  disabled: boolean;
}>;

export type RetryPolicy = Readonly<{
  initialDelayMs: number;
  maximumDelayMs: number;
  multiplier: number;
  maximumAttempts: number;
}>;

export type SyncCoordinatorOptions = Readonly<{
  remoteId: string;
  localDeviceId: string;
  local: CoordinatorLocalStore;
  /** Null keeps the app fully local and makes sync calls safe no-ops. */
  transport: SyncTransport | null;
  hashText?: HashText;
  now?: () => number;
  retryPolicy?: Partial<RetryPolicy>;
  uploadReadLimit?: number;
  uploadSegmentLimits?: Partial<SegmentLimits>;
  maxSegmentsPerDevice?: number;
  maxPullPages?: number;
}>;

export type ApplyRemoteResult = Readonly<{
  segments: number;
  appliedMutations: number;
  duplicateMutations: number;
  ignoredConflicts: number;
  state: PullChainState;
}>;
