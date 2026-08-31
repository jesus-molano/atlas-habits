import type { SQLiteDatabase } from 'expo-sqlite';

import { parseStoredJson } from '../canonical-json';
import { withWriteTransaction } from '../transaction';

type OplogRow = {
  op_id: string;
  command_id: string;
  workspace_id: string;
  device_id: string;
  device_seq: number;
  entity_type: string;
  entity_id: string;
  operation: 'upsert' | 'delete';
  payload_json: string;
  hlc: string;
  created_at: number;
  uploaded_at: number | null;
  attempts: number;
  last_error: string | null;
};

export type PendingOperation = {
  opId: string;
  commandId: string;
  workspaceId: string;
  deviceId: string;
  deviceSeq: number;
  entityType: string;
  entityId: string;
  operation: 'upsert' | 'delete';
  payload: unknown;
  hlc: string;
  createdAt: number;
  uploadedAt: number | null;
  attempts: number;
  lastError: string | null;
};

type SequenceRow = { device_id: string; sequence: number };

function normalizeLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error('The sync limit must be positive.');
  return Math.min(limit, 1_000);
}

function mapOperation(row: OplogRow): PendingOperation {
  return {
    opId: row.op_id,
    commandId: row.command_id,
    workspaceId: row.workspace_id,
    deviceId: row.device_id,
    deviceSeq: row.device_seq,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    payload: parseStoredJson(row.payload_json, `oplog entry ${row.op_id}`),
    hlc: row.hlc,
    createdAt: row.created_at,
    uploadedAt: row.uploaded_at,
    attempts: row.attempts,
    lastError: row.last_error,
  };
}

export class SyncRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  async listPendingOperations(
    deviceId: string,
    limit = 100,
  ): Promise<PendingOperation[]> {
    const rows = await this.database.getAllAsync<OplogRow>(
      `SELECT op_id, command_id, workspace_id, device_id, device_seq,
              entity_type, entity_id, operation, payload_json, hlc, created_at,
              uploaded_at, attempts, last_error
       FROM oplog
       WHERE device_id = ? AND uploaded_at IS NULL
       ORDER BY device_seq
       LIMIT ?`,
      [deviceId, normalizeLimit(limit)],
    );
    return rows.map(mapOperation);
  }

  async listDeviceOperationsAfter(
    deviceId: string,
    sequenceExclusive: number,
    limit = 100,
  ): Promise<PendingOperation[]> {
    const rows = await this.database.getAllAsync<OplogRow>(
      `SELECT op_id, command_id, workspace_id, device_id, device_seq,
              entity_type, entity_id, operation, payload_json, hlc, created_at,
              uploaded_at, attempts, last_error
       FROM oplog
       WHERE device_id = ? AND device_seq > ?
       ORDER BY device_seq
       LIMIT ?`,
      [deviceId, sequenceExclusive, normalizeLimit(limit)],
    );
    return rows.map(mapOperation);
  }

  async getLastSequences(): Promise<Record<string, number>> {
    const rows = await this.database.getAllAsync<SequenceRow>(
      'SELECT device_id, sequence FROM device_clocks ORDER BY device_id',
    );
    return Object.fromEntries(rows.map((row) => [row.device_id, row.sequence]));
  }

  async markUploaded(
    operationIds: readonly string[],
    uploadedAt = Date.now(),
  ): Promise<void> {
    if (operationIds.length === 0) return;
    await withWriteTransaction(this.database, async (transaction) => {
      const placeholders = operationIds.map(() => '?').join(', ');
      await transaction.runAsync(
        `UPDATE oplog
         SET uploaded_at = ?, attempts = attempts + 1, last_error = NULL
         WHERE op_id IN (${placeholders})`,
        [uploadedAt, ...operationIds],
      );
    });
  }

  async markUploadFailed(
    operationIds: readonly string[],
    message: string,
  ): Promise<void> {
    if (operationIds.length === 0) return;
    await withWriteTransaction(this.database, async (transaction) => {
      const placeholders = operationIds.map(() => '?').join(', ');
      await transaction.runAsync(
        `UPDATE oplog
         SET attempts = attempts + 1, last_error = ?
         WHERE op_id IN (${placeholders})`,
        [message.slice(0, 2_000), ...operationIds],
      );
    });
  }
}
