import type {
  CommandDispatchResult,
  CommandEnvelope,
  CommandGateway,
} from '../platform/commands';

export type AtlasSnapshotInvalidationReason =
  'local-save' | 'platform-command' | 'remote-sync';

type SnapshotInvalidationListener = (
  reason: AtlasSnapshotInvalidationReason,
) => void;

const snapshotInvalidationListeners = new Set<SnapshotInvalidationListener>();

export function emitAtlasSnapshotInvalidation(
  reason: AtlasSnapshotInvalidationReason,
): void {
  for (const listener of snapshotInvalidationListeners) listener(reason);
}

export function subscribeToAtlasSnapshotInvalidations(
  listener: SnapshotInvalidationListener,
): () => void {
  snapshotInvalidationListeners.add(listener);
  return () => snapshotInvalidationListeners.delete(listener);
}

export type InvalidatingCommandGatewayOptions = Readonly<{
  afterDispatch?: () => Promise<void> | void;
}>;

/**
 * Adds runtime refresh behavior without weakening the idempotency guarantees of
 * the SQLite-backed platform gateway.
 */
export function createInvalidatingCommandGateway(
  delegate: CommandGateway,
  options: InvalidatingCommandGatewayOptions = {},
): CommandGateway {
  return {
    async dispatch(envelope: CommandEnvelope): Promise<CommandDispatchResult> {
      const result = await delegate.dispatch(envelope);
      emitAtlasSnapshotInvalidation('platform-command');
      await options.afterDispatch?.();
      return result;
    },
  };
}
