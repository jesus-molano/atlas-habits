import type { AtlasAppAdapter, AtlasSnapshot } from './types';

export type SnapshotRequestToken = Readonly<{
  mutationGeneration: number;
  requestGeneration: number;
}>;

/**
 * Prevents an asynchronous canonical read from replacing newer optimistic UI
 * state. It also gives latest-request-wins semantics to overlapping reads.
 */
export class SnapshotApplyGuard {
  private mutationGeneration = 0;
  private requestGeneration = 0;

  markOptimisticMutation(): void {
    this.mutationGeneration += 1;
  }

  beginRequest(): SnapshotRequestToken {
    this.requestGeneration += 1;
    return {
      mutationGeneration: this.mutationGeneration,
      requestGeneration: this.requestGeneration,
    };
  }

  canApply(token: SnapshotRequestToken): boolean {
    return (
      token.mutationGeneration === this.mutationGeneration &&
      token.requestGeneration === this.requestGeneration
    );
  }

  cancelPendingRequests(): void {
    this.requestGeneration += 1;
  }
}

export type ProviderSnapshotRead = 'invalidation' | 'maintenance';

/**
 * Internal invalidations must be read-only. Foreground maintenance deliberately
 * uses loadSnapshot because the production adapter performs sync, timezone and
 * reminder maintenance on that path.
 */
export function readSnapshotForProvider(
  adapter: AtlasAppAdapter,
  reason: ProviderSnapshotRead,
): Promise<AtlasSnapshot | null> {
  if (reason === 'maintenance') return adapter.loadSnapshot();
  return adapter.refreshSnapshot?.() ?? Promise.resolve(null);
}
