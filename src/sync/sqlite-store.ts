import type { SQLiteDatabase } from 'expo-sqlite';

import { parseStoredJson, stableStringify } from '../data/canonical-json';
import { nextHlc } from '../data/clock';
import { withWriteTransaction, type SqlExecutor } from '../data/transaction';
import { LOCAL_WORKSPACE_ID } from '../data/types';

import type {
  AppliedMutationReceipt,
  EntityField,
  EntitySyncMetadata,
  LocalApplyTransaction,
  PullChainState,
  UploadChainState,
  VersionStamp,
} from './coordinator/types';
import { parseAndValidateHlc } from './coordinator/version';
import { SyncIntegrityError } from './errors';
import {
  deleteMaterializedEntity,
  entityExists,
  upsertMaterializedEntity,
} from './sqlite-materializer';

type ClockRow = Readonly<{
  field_name: string;
  hlc: string;
  device_id: string;
}>;

type TombstoneRow = Readonly<{
  hlc: string;
  device_id: string;
}>;

type ReceiptRow = Readonly<{
  mutation_id: string;
  device_id: string;
  device_seq: number;
  hlc: string;
  entity_type: string;
  entity_id: string;
  operation: 'upsert' | 'delete';
  payload_json: string;
}>;

type CursorRow = Readonly<{ pull_cursor: string | null }>;
type UploadRow = Readonly<{
  last_seq: number;
  last_segment_hash: string | null;
  last_hlc: string | null;
}>;

const EMPTY_PULL_STATE: PullChainState = {
  cursor: { lastSeqByDevice: {} },
  lastSegmentHashByDevice: {},
  lastHlcByDevice: {},
};

function copyPullState(state: PullChainState): PullChainState {
  return {
    cursor: { lastSeqByDevice: { ...state.cursor.lastSeqByDevice } },
    lastSegmentHashByDevice: { ...state.lastSegmentHashByDevice },
    lastHlcByDevice: { ...state.lastHlcByDevice },
  };
}

function parsePullState(value: string | null): PullChainState {
  if (!value) return copyPullState(EMPTY_PULL_STATE);
  const parsed = parseStoredJson<unknown>(value, 'sync pull state');
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SyncIntegrityError('The persisted sync pull state is invalid.');
  }
  const candidate = parsed as Record<string, unknown>;
  const cursor = candidate.cursor;
  const hashes = candidate.lastSegmentHashByDevice;
  const clocks = candidate.lastHlcByDevice;
  if (
    typeof cursor !== 'object' ||
    cursor === null ||
    Array.isArray(cursor) ||
    typeof (cursor as Record<string, unknown>).lastSeqByDevice !== 'object' ||
    typeof hashes !== 'object' ||
    hashes === null ||
    Array.isArray(hashes) ||
    typeof clocks !== 'object' ||
    clocks === null ||
    Array.isArray(clocks)
  ) {
    throw new SyncIntegrityError(
      'The persisted sync pull state is incomplete.',
    );
  }

  const sequences: Record<string, number> = {};
  for (const [deviceId, sequence] of Object.entries(
    (cursor as { lastSeqByDevice: Record<string, unknown> }).lastSeqByDevice,
  )) {
    if (!Number.isSafeInteger(sequence) || (sequence as number) < 0) {
      throw new SyncIntegrityError(`Invalid persisted cursor for ${deviceId}.`);
    }
    sequences[deviceId] = sequence as number;
  }

  const normalizedHashes: Record<string, string> = {};
  for (const [deviceId, hash] of Object.entries(hashes)) {
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/u.test(hash)) {
      throw new SyncIntegrityError(
        `Invalid persisted chain hash for ${deviceId}.`,
      );
    }
    normalizedHashes[deviceId] = hash;
  }

  const normalizedClocks: Record<string, string> = {};
  for (const [deviceId, hlc] of Object.entries(clocks)) {
    if (
      typeof hlc !== 'string' ||
      parseAndValidateHlc(hlc).deviceId !== deviceId
    ) {
      throw new SyncIntegrityError(`Invalid persisted HLC for ${deviceId}.`);
    }
    normalizedClocks[deviceId] = hlc;
  }

  return {
    cursor: { lastSeqByDevice: sequences },
    lastSegmentHashByDevice: normalizedHashes,
    lastHlcByDevice: normalizedClocks,
  };
}

class SQLiteApplyTransaction implements LocalApplyTransaction {
  constructor(
    private readonly executor: SqlExecutor,
    private readonly localDeviceId: string,
  ) {}

  async getPullState(remoteId: string): Promise<PullChainState> {
    const row = await this.executor.getFirstAsync<CursorRow>(
      `SELECT pull_cursor
       FROM sync_cursors
       WHERE workspace_id = ? AND remote_name = ?`,
      [LOCAL_WORKSPACE_ID, remoteId],
    );
    return parsePullState(row?.pull_cursor ?? null);
  }

  async setPullState(
    remoteId: string,
    state: PullChainState,
    appliedAt: number,
  ): Promise<void> {
    await this.executor.runAsync(
      `INSERT INTO sync_cursors
        (workspace_id, remote_name, pull_cursor, last_pulled_at, last_error)
       VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(workspace_id, remote_name) DO UPDATE SET
         pull_cursor = excluded.pull_cursor,
         last_pulled_at = excluded.last_pulled_at,
         last_error = NULL`,
      [LOCAL_WORKSPACE_ID, remoteId, stableStringify(state), appliedAt],
    );
  }

  async getAppliedMutation(
    mutationId: string,
  ): Promise<AppliedMutationReceipt | null> {
    const row = await this.executor.getFirstAsync<ReceiptRow>(
      `SELECT mutation_id, device_id, device_seq, hlc, entity_type, entity_id,
              operation, payload_json
       FROM sync_applied_mutations
       WHERE mutation_id = ?`,
      [mutationId],
    );
    return row
      ? {
          mutationId: row.mutation_id,
          deviceId: row.device_id,
          seq: row.device_seq,
          hlc: row.hlc,
          entityType: row.entity_type,
          entityId: row.entity_id,
          operation: row.operation,
          payloadJson: row.payload_json,
        }
      : null;
  }

  async recordAppliedMutation(
    receipt: AppliedMutationReceipt,
    appliedAt: number,
  ): Promise<void> {
    await this.executor.runAsync(
      `INSERT INTO sync_applied_mutations
        (mutation_id, device_id, device_seq, hlc, entity_type, entity_id,
         operation, payload_json, applied_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receipt.mutationId,
        receipt.deviceId,
        receipt.seq,
        receipt.hlc,
        receipt.entityType,
        receipt.entityId,
        receipt.operation,
        receipt.payloadJson,
        appliedAt,
      ],
    );
  }

  async getEntityMetadata(
    entityType: string,
    entityId: string,
  ): Promise<EntitySyncMetadata> {
    const [clockRows, tombstone, exists] = await Promise.all([
      this.executor.getAllAsync<ClockRow>(
        `SELECT field_name, hlc, device_id
         FROM clocks
         WHERE entity_type = ? AND entity_id = ?`,
        [entityType, entityId],
      ),
      this.executor.getFirstAsync<TombstoneRow>(
        `SELECT hlc, device_id
         FROM tombstones
         WHERE entity_type = ? AND entity_id = ?`,
        [entityType, entityId],
      ),
      entityExists(this.executor, entityType, entityId),
    ]);
    let wildcardVersion: VersionStamp | null = null;
    const fieldVersions: Record<string, VersionStamp> = {};
    for (const row of clockRows) {
      const version: VersionStamp = {
        hlc: row.hlc,
        deviceId: row.device_id,
        operation: 'upsert',
      };
      if (row.field_name === '*') wildcardVersion = version;
      else fieldVersions[row.field_name] = version;
    }
    return {
      exists,
      wildcardVersion,
      fieldVersions,
      tombstone: tombstone
        ? {
            hlc: tombstone.hlc,
            deviceId: tombstone.device_id,
            operation: 'delete',
          }
        : null,
    };
  }

  async upsertEntityFields(
    mutation: Parameters<LocalApplyTransaction['upsertEntityFields']>[0],
    fields: readonly EntityField[],
  ): Promise<void> {
    await upsertMaterializedEntity(this.executor, mutation, fields);
  }

  async deleteEntity(
    mutation: Parameters<LocalApplyTransaction['deleteEntity']>[0],
  ): Promise<void> {
    await deleteMaterializedEntity(this.executor, mutation);
  }

  async setFieldVersion(
    entityType: string,
    entityId: string,
    fieldName: string,
    version: VersionStamp,
    appliedAt: number,
  ): Promise<void> {
    await this.executor.runAsync(
      `INSERT INTO clocks
        (entity_type, entity_id, field_name, hlc, device_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_type, entity_id, field_name) DO UPDATE SET
         hlc = excluded.hlc,
         device_id = excluded.device_id,
         updated_at = excluded.updated_at`,
      [
        entityType,
        entityId,
        fieldName,
        version.hlc,
        version.deviceId,
        appliedAt,
      ],
    );
  }

  async setTombstone(
    entityType: string,
    entityId: string,
    version: VersionStamp,
    appliedAt: number,
  ): Promise<void> {
    await this.executor.runAsync(
      `INSERT INTO tombstones
        (entity_type, entity_id, hlc, device_id, deleted_at, acknowledged_at)
       VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET
         hlc = excluded.hlc,
         device_id = excluded.device_id,
         deleted_at = excluded.deleted_at,
         acknowledged_at = NULL`,
      [entityType, entityId, version.hlc, version.deviceId, appliedAt],
    );
  }

  async clearTombstone(entityType: string, entityId: string): Promise<void> {
    await this.executor.runAsync(
      'DELETE FROM tombstones WHERE entity_type = ? AND entity_id = ?',
      [entityType, entityId],
    );
  }

  async observeRemoteHlc(hlc: string, observedAt: number): Promise<void> {
    await nextHlc(this.executor, this.localDeviceId, observedAt, hlc);
  }
}

/** SQLite seam used by the provider-neutral remote segment applier. */
export class SQLiteSyncStore {
  constructor(
    private readonly database: SQLiteDatabase,
    private readonly localDeviceId: string,
  ) {}

  async getPullState(remoteId: string): Promise<PullChainState> {
    const transaction = new SQLiteApplyTransaction(
      this.database,
      this.localDeviceId,
    );
    return transaction.getPullState(remoteId);
  }

  async runApplyTransaction<T>(
    work: (transaction: LocalApplyTransaction) => Promise<T>,
  ): Promise<T> {
    return withWriteTransaction(this.database, async (executor) => {
      await executor.execAsync('PRAGMA defer_foreign_keys = ON;');
      return work(new SQLiteApplyTransaction(executor, this.localDeviceId));
    });
  }

  async getUploadState(remoteId: string): Promise<UploadChainState> {
    const row = await this.database.getFirstAsync<UploadRow>(
      `SELECT last_seq, last_segment_hash, last_hlc
       FROM sync_upload_chains
       WHERE workspace_id = ? AND remote_name = ? AND device_id = ?`,
      [LOCAL_WORKSPACE_ID, remoteId, this.localDeviceId],
    );
    return row
      ? {
          lastSeq: row.last_seq,
          lastSegmentHash: row.last_segment_hash,
          lastHlc: row.last_hlc,
        }
      : { lastSeq: 0, lastSegmentHash: null, lastHlc: null };
  }

  async markPushed(
    remoteId: string,
    pushedAt: number,
    state: UploadChainState,
  ): Promise<void> {
    await withWriteTransaction(this.database, async (executor) => {
      await executor.runAsync(
        `INSERT INTO sync_cursors
          (workspace_id, remote_name, last_pushed_at, last_error)
         VALUES (?, ?, ?, NULL)
         ON CONFLICT(workspace_id, remote_name) DO UPDATE SET
           last_pushed_at = excluded.last_pushed_at,
           last_error = NULL`,
        [LOCAL_WORKSPACE_ID, remoteId, pushedAt],
      );
      await executor.runAsync(
        `INSERT INTO sync_upload_chains
          (workspace_id, remote_name, device_id, last_seq, last_segment_hash,
           last_hlc, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, remote_name, device_id) DO UPDATE SET
           last_seq = excluded.last_seq,
           last_segment_hash = excluded.last_segment_hash,
           last_hlc = excluded.last_hlc,
           updated_at = excluded.updated_at`,
        [
          LOCAL_WORKSPACE_ID,
          remoteId,
          this.localDeviceId,
          state.lastSeq,
          state.lastSegmentHash,
          state.lastHlc,
          pushedAt,
        ],
      );
    });
  }

  async markFailed(remoteId: string, message: string): Promise<void> {
    await withWriteTransaction(this.database, async (executor) => {
      await executor.runAsync(
        `INSERT INTO sync_cursors (workspace_id, remote_name, last_error)
         VALUES (?, ?, ?)
         ON CONFLICT(workspace_id, remote_name) DO UPDATE SET
           last_error = excluded.last_error`,
        [LOCAL_WORKSPACE_ID, remoteId, message.slice(0, 2_000)],
      );
    });
  }
}
