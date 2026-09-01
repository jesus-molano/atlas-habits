import type { SQLiteDatabase } from 'expo-sqlite';

import { SyncRepository } from '../data/repositories/sync-repository';
import type { AdapterActionResult, SyncState } from '../features/atlas/types';
import {
  buildSyncSegments,
  createOptionalSyncProvider,
  mutationEnvelopeFromOplog,
  sha256Hex,
  type OptionalSyncProvider,
  type HashText,
  type SyncUser,
} from '../sync';
import { applyRemoteSegments } from '../sync/coordinator/apply';
import type { SyncRunSummary, SyncTrigger } from '../sync/coordinator/types';
import { SyncIntegrityError } from '../sync/errors';
import { SQLiteSyncStore } from '../sync/sqlite-store';

import { SerializedAsyncQueue } from './serial-queue';
import { googleAccessFailure, syncIssueFor } from './sync-error-copy';

async function allDeviceOperations(
  repository: SyncRepository,
  deviceId: string,
) {
  const operations = [];
  let after = 0;
  for (;;) {
    const page = await repository.listDeviceOperationsAfter(
      deviceId,
      after,
      1_000,
    );
    operations.push(...page);
    if (page.length < 1_000) return operations;
    after = page[page.length - 1].deviceSeq;
  }
}

export class OptionalAtlasSync {
  private readonly queue = new SerializedAsyncQueue();
  private user: SyncUser | null = null;

  constructor(
    private readonly database: SQLiteDatabase,
    private readonly deviceId: string,
    private readonly provider: OptionalSyncProvider = createOptionalSyncProvider(),
    private readonly options: Readonly<{
      hashText?: HashText;
      now?: () => number;
      maxPullPages?: number;
      maxSegmentsPerDevice?: number;
    }> = {},
  ) {}

  async state(restore = true): Promise<SyncState> {
    if (this.provider.mode === 'local-only') return { status: 'local-only' };
    try {
      this.user = restore
        ? await this.provider.auth.restoreSession()
        : await this.provider.auth.getSession();
      return this.user
        ? { status: 'connected', accountEmail: this.user.email ?? undefined }
        : { status: 'local-only' };
    } catch (error) {
      const failure = googleAccessFailure(error);
      const { issue } = syncIssueFor(error);
      return {
        status: 'error',
        message: failure.message,
        issue,
      };
    }
  }

  async connect(): Promise<AdapterActionResult> {
    if (this.provider.mode === 'local-only') {
      return {
        ok: false,
        message:
          'Esta versión no incluye la configuración necesaria para acceder con Google. Puedes seguir usando Atlas en modo local.',
      };
    }
    try {
      const user = await this.provider.auth.signIn();
      if (!user)
        return { ok: false, message: 'Se canceló el acceso con Google.' };
      this.user = user;
      try {
        await this.syncNow('manual');
        return {
          ok: true,
          accountEmail: user.email ?? undefined,
          message:
            'Cuenta conectada. Los datos locales y remotos están sincronizados.',
        };
      } catch (error) {
        const { failure, issue } = syncIssueFor(error);
        if (!failure.retryable) {
          await this.provider.auth.signOut().catch(() => undefined);
          this.user = null;
          return {
            ok: false,
            message: failure.message,
            syncIssue: issue,
          };
        }
        return {
          ok: true,
          accountEmail: user.email ?? undefined,
          message: failure.message,
          syncIssue: issue,
        };
      }
    } catch (error) {
      const failure = googleAccessFailure(error);
      const { issue } = syncIssueFor(error);
      return {
        ok: false,
        message: failure.message,
        syncIssue: issue,
      };
    }
  }

  async disconnect(): Promise<AdapterActionResult> {
    if (this.provider.mode === 'local-only') {
      return { ok: true, message: 'Atlas ya estaba en modo local.' };
    }
    try {
      await this.provider.auth.signOut();
      this.user = null;
      return {
        ok: true,
        message:
          'Cuenta desconectada. Los datos locales se conservan en el dispositivo.',
      };
    } catch {
      return {
        ok: false,
        message:
          'No se pudo cerrar la sesión de Google. La copia local no se ha eliminado.',
      };
    }
  }

  queuePush(): void {
    if (this.provider.mode === 'local-only' || !this.user) return;
    void this.syncNow('local_change').catch(() => {
      // SQLite keeps the oplog pending. A later local write or sign-in retries it.
    });
  }

  async syncNow(trigger: SyncTrigger = 'manual'): Promise<SyncRunSummary> {
    return this.queue.enqueue(() => this.runSync(trigger));
  }

  private async runSync(trigger: SyncTrigger): Promise<SyncRunSummary> {
    const startedAt = this.options.now?.() ?? Date.now();
    const disabled = (): SyncRunSummary => ({
      trigger,
      startedAt,
      finishedAt: this.options.now?.() ?? Date.now(),
      uploadedOperations: 0,
      uploadedSegments: 0,
      downloadedSegments: 0,
      appliedMutations: 0,
      duplicateMutations: 0,
      ignoredConflicts: 0,
      disabled: true,
    });
    if (this.provider.mode === 'local-only') return disabled();
    const session = this.user ?? (await this.provider.auth.getSession());
    if (!session) return disabled();
    this.user = session;

    const remoteId = this.provider.transport.providerId;
    const store = new SQLiteSyncStore(this.database, this.deviceId);
    let uploadedOperations = 0;
    let uploadedSegments = 0;
    let downloadedSegments = 0;
    let appliedMutations = 0;
    let duplicateMutations = 0;
    let ignoredConflicts = 0;

    try {
      const pushed = await this.pushNow(store, remoteId);
      uploadedOperations = pushed.operations;
      uploadedSegments = pushed.segments;

      const maximumPages = this.options.maxPullPages ?? 100;
      if (!Number.isSafeInteger(maximumPages) || maximumPages < 1) {
        throw new SyncIntegrityError(
          'maxPullPages must be a positive integer.',
        );
      }
      for (let page = 0; page < maximumPages; page += 1) {
        const pullState = await store.getPullState(remoteId);
        const pulled = await this.provider.transport.pull(pullState.cursor, {
          maxSegmentsPerDevice: this.options.maxSegmentsPerDevice ?? 100,
        });
        const hasMore = Object.values(pulled.hasMoreByDevice).some(Boolean);
        if (pulled.segments.length === 0) {
          if (hasMore) {
            throw new SyncIntegrityError(
              'The remote sync cursor did not advance.',
            );
          }
          break;
        }
        const appliedAt = this.options.now?.() ?? Date.now();
        const result = await applyRemoteSegments({
          remoteId,
          segments: pulled.segments,
          hashText: this.options.hashText ?? sha256Hex,
          appliedAt,
          ignoredDeviceIds: new Set([this.deviceId]),
          runTransaction: (work) => store.runApplyTransaction(work),
        });
        downloadedSegments += result.segments;
        appliedMutations += result.appliedMutations;
        duplicateMutations += result.duplicateMutations;
        ignoredConflicts += result.ignoredConflicts;
        if (!hasMore) break;
        if (page === maximumPages - 1) {
          throw new SyncIntegrityError(
            'The remote sync history exceeded the pull page limit.',
          );
        }
      }
    } catch (error) {
      await store
        .markFailed(
          remoteId,
          error instanceof Error ? error.message : 'Unexpected sync failure.',
        )
        .catch(() => undefined);
      throw error;
    }

    return {
      trigger,
      startedAt,
      finishedAt: this.options.now?.() ?? Date.now(),
      uploadedOperations,
      uploadedSegments,
      downloadedSegments,
      appliedMutations,
      duplicateMutations,
      ignoredConflicts,
      disabled: false,
    };
  }

  private async pushNow(
    store: SQLiteSyncStore,
    remoteId: string,
  ): Promise<Readonly<{ operations: number; segments: number }>> {
    if (this.provider.mode === 'local-only')
      return { operations: 0, segments: 0 };
    const repository = new SyncRepository(this.database);
    const operations = await allDeviceOperations(repository, this.deviceId);
    if (operations.length === 0) return { operations: 0, segments: 0 };
    const envelopes = operations.map(mutationEnvelopeFromOplog);
    // One immutable operation per segment keeps every historical boundary
    // stable when later operations are appended and the chain is rebuilt.
    const segments = await buildSyncSegments(envelopes, {
      limits: { maxOperations: 1 },
      hashText: this.options.hashText,
    });
    const storedUpload = await store.getUploadState(remoteId);
    if (storedUpload.lastSeq > 0) {
      const anchor = segments.find(
        (segment) => segment.lastSeq === storedUpload.lastSeq,
      );
      const anchorHlc =
        anchor?.operations[anchor.operations.length - 1]?.hlc ?? null;
      if (
        !anchor ||
        anchor.contentHash !== storedUpload.lastSegmentHash ||
        anchorHlc !== storedUpload.lastHlc
      ) {
        throw new SyncIntegrityError(
          'The persisted upload hash chain does not match the local oplog.',
        );
      }
    }
    const pendingIds = operations
      .filter((operation) => operation.uploadedAt === null)
      .map((operation) => operation.opId);
    try {
      await this.provider.transport.uploadSegments(segments);
      const pushedAt = this.options.now?.() ?? Date.now();
      await repository.markUploaded(pendingIds, pushedAt);
      const lastSegment = segments[segments.length - 1];
      await store.markPushed(remoteId, pushedAt, {
        lastSeq: lastSegment.lastSeq,
        lastSegmentHash: lastSegment.contentHash,
        lastHlc: lastSegment.operations[lastSegment.operations.length - 1].hlc,
      });
    } catch (error) {
      await repository
        .markUploadFailed(
          pendingIds,
          error instanceof Error ? error.message : 'Unexpected upload failure.',
        )
        .catch(() => undefined);
      throw error;
    }
    return { operations: pendingIds.length, segments: segments.length };
  }
}
