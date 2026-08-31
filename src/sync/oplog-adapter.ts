import type { PendingOperation } from '../data/repositories/sync-repository';

import type { SyncMutationEnvelope } from './types';
import { assertJsonValue } from './validation';

/** Maps the persisted SQLite oplog shape to the provider-neutral wire shape. */
export function mutationEnvelopeFromOplog(
  operation: PendingOperation,
): SyncMutationEnvelope {
  assertJsonValue(operation.payload, `oplog payload ${operation.opId}`);
  return {
    schemaVersion: 1,
    mutationId: operation.opId,
    deviceId: operation.deviceId,
    seq: operation.deviceSeq,
    hlc: operation.hlc,
    entityType: operation.entityType,
    entityId: operation.entityId,
    operation: operation.operation,
    payload: operation.payload,
  };
}
