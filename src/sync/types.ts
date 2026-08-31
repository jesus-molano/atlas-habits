export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * Stable, provider-agnostic representation of one local oplog entry.
 *
 * `seq` is monotonic per device and must be persisted locally before an
 * upload is attempted. A sequence must never be reused for different data.
 */
export type SyncMutationEnvelope = Readonly<{
  schemaVersion: 1;
  mutationId: string;
  deviceId: string;
  seq: number;
  hlc: string;
  entityType: string;
  entityId: string;
  operation: 'upsert' | 'delete';
  payload: JsonValue;
}>;

/** Immutable unit written to a remote sync transport. */
export type SyncSegmentEnvelope = Readonly<{
  schemaVersion: 1;
  segmentId: string;
  deviceId: string;
  firstSeq: number;
  lastSeq: number;
  operationCount: number;
  previousSegmentHash: string | null;
  contentHash: string;
  operations: readonly SyncMutationEnvelope[];
}>;

/** Vector cursor. Each value is the last contiguous sequence applied locally. */
export type SyncCursor = Readonly<{
  lastSeqByDevice: Readonly<Record<string, number>>;
}>;

export type SyncPullResult = Readonly<{
  segments: readonly SyncSegmentEnvelope[];
  cursor: SyncCursor;
  hasMoreByDevice: Readonly<Record<string, boolean>>;
}>;

export type SyncUploadResult = Readonly<{
  created: number;
  alreadyPresent: number;
}>;

export type SyncUser = Readonly<{
  uid: string;
  displayName: string | null;
  email: string | null;
  photoUrl: string | null;
}>;

export interface SyncAuthAdapter {
  readonly providerId: string;
  getSession(): Promise<SyncUser | null>;
  restoreSession(): Promise<SyncUser | null>;
  signIn(): Promise<SyncUser | null>;
  signOut(): Promise<void>;
}

export interface SyncTransport {
  readonly providerId: string;
  uploadSegments(
    segments: readonly SyncSegmentEnvelope[],
  ): Promise<SyncUploadResult>;
  pull(
    cursor: SyncCursor,
    options?: Readonly<{ maxSegmentsPerDevice?: number }>,
  ): Promise<SyncPullResult>;
}

export type RemoteSyncProvider = Readonly<{
  mode: 'remote';
  providerId: 'firebase';
  auth: SyncAuthAdapter;
  transport: SyncTransport;
}>;

export type LocalOnlySyncProvider = Readonly<{
  mode: 'local-only';
  providerId: null;
  reason: 'not-configured' | 'incomplete-config';
  missingEnvironmentVariables: readonly string[];
  auth: null;
  transport: null;
}>;

export type OptionalSyncProvider = RemoteSyncProvider | LocalOnlySyncProvider;
