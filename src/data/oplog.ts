import { stableStringify } from './canonical-json';
import { nextDeviceSequence, nextHlc } from './clock';
import type { SqlExecutor } from './transaction';
import { LOCAL_WORKSPACE_ID, type OplogMutation } from './types';
import { createUuid } from './uuid';

export async function recordMutation(
  transaction: SqlExecutor,
  mutation: OplogMutation,
): Promise<string> {
  const now = mutation.now ?? Date.now();
  const hlc = await nextHlc(
    transaction,
    mutation.deviceId,
    now,
    mutation.observedHlc,
  );
  const deviceSequence = await nextDeviceSequence(
    transaction,
    mutation.deviceId,
    now,
  );
  const changedFields = mutation.changedFields?.length
    ? mutation.changedFields
    : ['*'];

  for (const fieldName of changedFields) {
    await transaction.runAsync(
      `INSERT INTO clocks
        (entity_type, entity_id, field_name, hlc, device_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_type, entity_id, field_name) DO UPDATE SET
         hlc = excluded.hlc,
         device_id = excluded.device_id,
         updated_at = excluded.updated_at
       WHERE excluded.hlc > clocks.hlc`,
      [
        mutation.entityType,
        mutation.entityId,
        fieldName,
        hlc,
        mutation.deviceId,
        now,
      ],
    );
  }

  if (mutation.operation === 'delete') {
    await transaction.runAsync(
      `INSERT INTO tombstones
        (entity_type, entity_id, hlc, device_id, deleted_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET
         hlc = excluded.hlc,
         device_id = excluded.device_id,
         deleted_at = excluded.deleted_at,
         acknowledged_at = NULL
       WHERE excluded.hlc > tombstones.hlc`,
      [mutation.entityType, mutation.entityId, hlc, mutation.deviceId, now],
    );
  } else {
    await transaction.runAsync(
      `DELETE FROM tombstones
       WHERE entity_type = ? AND entity_id = ? AND hlc < ?`,
      [mutation.entityType, mutation.entityId, hlc],
    );
  }

  const operationId = createUuid();
  await transaction.runAsync(
    `INSERT INTO oplog
      (op_id, command_id, workspace_id, device_id, device_seq, entity_type, entity_id,
       operation, payload_json, hlc, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      operationId,
      mutation.commandId,
      mutation.workspaceId ?? LOCAL_WORKSPACE_ID,
      mutation.deviceId,
      deviceSequence,
      mutation.entityType,
      mutation.entityId,
      mutation.operation,
      stableStringify(mutation.payload),
      hlc,
      now,
    ],
  );

  return hlc;
}
