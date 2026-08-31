import { describe, expect, it, vi } from 'vitest';

import type { CommandEnvelope, CommandGateway } from '../platform/commands';

import {
  createInvalidatingCommandGateway,
  subscribeToAtlasSnapshotInvalidations,
} from './runtime-events';

const envelope: CommandEnvelope = {
  command: {
    type: 'occurrence.complete',
    targetKind: 'habit',
    targetId: 'water',
    occurrenceId: 'atlas:v1:habit:water:2026-08-31',
    completed: true,
  },
  idempotencyKey: 'complete-water',
  issuedAt: '2026-08-31T12:00:00.000Z',
  source: 'widget',
};

describe('runtime snapshot invalidations', () => {
  it('emits only after the durable gateway applies the command', async () => {
    const events: string[] = [];
    const unsubscribe = subscribeToAtlasSnapshotInvalidations((reason) =>
      events.push(reason),
    );
    const afterDispatch = vi.fn(async () => undefined);
    const delegate: CommandGateway = {
      dispatch: vi.fn(async () => ({ status: 'applied' as const })),
    };
    const gateway = createInvalidatingCommandGateway(delegate, {
      afterDispatch,
    });

    await expect(gateway.dispatch(envelope)).resolves.toEqual({
      status: 'applied',
    });
    expect(events).toEqual(['platform-command']);
    expect(afterDispatch).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('does not announce a mutation when persistence fails', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToAtlasSnapshotInvalidations(listener);
    const gateway = createInvalidatingCommandGateway({
      dispatch: vi.fn(async () => {
        throw new Error('disk full');
      }),
    });

    await expect(gateway.dispatch(envelope)).rejects.toThrow('disk full');
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
