import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getCommandGateway, getDatabase, type CommandGateway } from '../data';
import { createFallbackSnapshot } from '../features/atlas/fallback-data';
import type {
  AdapterActionResult,
  AtlasAppAdapter,
  AtlasSnapshot,
  SyncState,
} from '../features/atlas/types';
import {
  configureReminderCategoryAndChannelAsync,
  getExactAlarmAccessAsync,
  requestExactAlarmAccessAsync,
} from '../platform/notifications';
import {
  checkForAtlasUpdateAsync,
  getAtlasInstallPermissionAsync,
  installAtlasUpdateAsync,
  isNativeUpdaterAvailable,
  requestAtlasInstallPermissionAsync,
} from '../platform/updater';
import { refreshAtlasWidgetsAsync } from '../widgets';

import { localDateFromDate } from './date-time';
import { getAtlasDeviceId } from './device-identity';
import { OptionalAtlasSync } from './optional-sync';
import { AtlasSnapshotWriter } from './persistence';
import { rescheduleAtlasRemindersAsync } from './reminder-scheduler';
import {
  emitAtlasSnapshotInvalidation,
  subscribeToAtlasSnapshotInvalidations,
} from './runtime-events';
import { SerializedAsyncQueue } from './serial-queue';
import { diffAtlasSnapshots } from './snapshot-diff';
import { loadAtlasSnapshotFromSQLite } from './snapshot-loader';
import { atlasWidgetDataSource } from './widget-data-source';

const STARTER_SEED_COMMAND_ID = 'atlas:starter-seed:v1';

type SQLiteAtlasRuntime = Readonly<{
  database: SQLiteDatabase;
  gateway: CommandGateway;
  deviceId: string;
  sync: OptionalAtlasSync;
  writer: AtlasSnapshotWriter;
}>;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function emptySnapshot(sync: SyncState): AtlasSnapshot {
  return {
    schemaVersion: 1,
    source: 'local_store',
    habits: [],
    tasks: [],
    routines: [],
    dashboardOrder: ['routines', 'habits', 'tasks'],
    history: [],
    habitHistory: {},
    sync,
  };
}

async function hasStarterSeedMarker(
  database: SQLiteDatabase,
): Promise<boolean> {
  const marker = await database.getFirstAsync<{ command_id: string }>(
    'SELECT command_id FROM command_receipts WHERE command_id = ?',
    [STARTER_SEED_COMMAND_ID],
  );
  return marker !== null;
}

async function markStarterSeeded(
  database: SQLiteDatabase,
  now: number,
): Promise<void> {
  await database.runAsync(
    `INSERT OR IGNORE INTO command_receipts
      (command_id, command_name, request_fingerprint, result_json, applied_at)
     VALUES (?, 'application.seed', 'atlas-starter-seed-v1', ?, ?)`,
    [STARTER_SEED_COMMAND_ID, JSON.stringify({ seedVersion: 1 }), now],
  );
}

async function itemIds(database: SQLiteDatabase): Promise<string[]> {
  const rows = await database.getAllAsync<{ id: string }>(
    'SELECT id FROM items ORDER BY id',
  );
  return rows.map((row) => row.id);
}

export class SQLiteAtlasAppAdapter implements AtlasAppAdapter {
  private runtimePromise: Promise<SQLiteAtlasRuntime> | null = null;
  private readonly writeQueue = new SerializedAsyncQueue();
  private requestedWriteGeneration = 0;
  private syncState: SyncState = { status: 'local-only' };
  private canonicalSnapshot: AtlasSnapshot | null = null;

  private runtime(): Promise<SQLiteAtlasRuntime> {
    this.runtimePromise ??= Promise.all([getDatabase(), getCommandGateway()])
      .then(([database, gateway]) => {
        const deviceId = getAtlasDeviceId();
        return {
          database,
          gateway,
          deviceId,
          sync: new OptionalAtlasSync(database, deviceId),
          writer: new AtlasSnapshotWriter(database, gateway, deviceId),
        };
      })
      .catch((error: unknown) => {
        this.runtimePromise = null;
        throw error;
      });
    return this.runtimePromise;
  }

  private async readRawCanonical(
    runtime: SQLiteAtlasRuntime,
    now = new Date(),
  ): Promise<AtlasSnapshot | null> {
    return loadAtlasSnapshotFromSQLite({
      database: runtime.database,
      gateway: runtime.gateway,
      now,
      syncState: this.syncState,
    });
  }

  private async readCanonical(
    runtime: SQLiteAtlasRuntime,
    now = new Date(),
  ): Promise<AtlasSnapshot> {
    return (
      (await this.readRawCanonical(runtime, now)) ??
      emptySnapshot(this.syncState)
    );
  }

  private async ensureStarterSeed(
    runtime: SQLiteAtlasRuntime,
    now: Date,
  ): Promise<void> {
    if (await hasStarterSeedMarker(runtime.database)) return;

    const seed = createFallbackSnapshot();
    const existingIds = await itemIds(runtime.database);
    const seedIds = new Set([
      ...seed.habits.map((item) => item.id),
      ...seed.tasks.map((item) => item.id),
      ...seed.routines.map((item) => item.id),
    ]);

    if (existingIds.length === 0) {
      await runtime.writer.applyChanges(
        diffAtlasSnapshots(null, seed, localDateFromDate(now)),
        seed,
        localDateFromDate(now),
      );
    } else if (existingIds.every((id) => seedIds.has(id))) {
      // Resume a first-launch seed that stopped between idempotent commands.
      const existingSet = new Set(existingIds);
      const missingItems = [
        ...seed.habits,
        ...seed.tasks,
        ...seed.routines,
      ].filter((item) => !existingSet.has(item.id));
      await runtime.writer.applyChanges(
        [
          ...missingItems.map((item) => ({
            kind: 'item.create' as const,
            item,
          })),
          { kind: 'dashboard.reorder' as const, order: seed.dashboardOrder },
        ],
        seed,
        localDateFromDate(now),
      );
    }

    const stillStarterOnly = (await itemIds(runtime.database)).every((id) =>
      seedIds.has(id),
    );
    if (stillStarterOnly) {
      // Some progress projections (for example, a routine step) need a run to
      // be created before it can then be closed. Two bounded passes converge
      // the starter snapshot without turning normal hydration into a loop.
      for (let pass = 0; pass < 2; pass += 1) {
        const materialized = await this.readRawCanonical(runtime, now);
        if (!materialized) break;
        const changes = diffAtlasSnapshots(
          materialized,
          seed,
          localDateFromDate(now),
        );
        if (changes.length === 0) break;
        await runtime.writer.applyChanges(
          changes,
          seed,
          localDateFromDate(now),
        );
      }
    }
    await markStarterSeeded(runtime.database, now.getTime());
  }

  private async runMaintenance(
    runtime: SQLiteAtlasRuntime,
    refreshWidgets = true,
  ): Promise<void> {
    const work: Promise<unknown>[] = [
      rescheduleAtlasRemindersAsync({ database: runtime.database }),
    ];
    if (refreshWidgets) {
      work.push(refreshAtlasWidgetsAsync(atlasWidgetDataSource));
    }
    await Promise.allSettled(work);
  }

  private queueLocalSync(runtime: SQLiteAtlasRuntime): void {
    void runtime.sync
      .syncNow('local_change')
      .then((summary) => {
        if (summary.appliedMutations === 0) return;
        void this.writeQueue
          .enqueue(async () => {
            this.canonicalSnapshot = await this.readCanonical(runtime);
            await this.runMaintenance(runtime);
            emitAtlasSnapshotInvalidation('remote-sync');
          })
          .catch(() => undefined);
      })
      .catch(() => {
        // The oplog remains pending and the foreground path retries safely.
      });
  }

  async loadSnapshot(): Promise<AtlasSnapshot> {
    return this.writeQueue.enqueue(async () => {
      const runtime = await this.runtime();
      const now = new Date();
      await this.ensureStarterSeed(runtime, now);
      this.syncState = await runtime.sync.state(true);
      if (this.syncState.status === 'connected') {
        try {
          await runtime.sync.syncNow('foreground');
        } catch {
          // The SQLite profile remains authoritative while offline. The oplog
          // and remote cursor make a later foreground retry safe.
        }
      }
      this.canonicalSnapshot = await this.readCanonical(runtime, now);
      await this.runMaintenance(runtime);
      return this.canonicalSnapshot;
    });
  }

  async refreshSnapshot(): Promise<AtlasSnapshot> {
    const runtime = await this.runtime();
    this.canonicalSnapshot = await this.readCanonical(runtime);
    return this.canonicalSnapshot;
  }

  async saveSnapshot(snapshot: AtlasSnapshot): Promise<void> {
    const generation = ++this.requestedWriteGeneration;
    await this.writeQueue.enqueue(async () => {
      const runtime = await this.runtime();
      const now = new Date();
      await this.ensureStarterSeed(runtime, now);
      const previous = await this.readCanonical(runtime, now);
      const changes = diffAtlasSnapshots(
        previous,
        snapshot,
        localDateFromDate(now),
      );
      if (changes.length > 0) {
        await runtime.writer.applyChanges(
          changes,
          snapshot,
          localDateFromDate(now),
        );
      }
      this.canonicalSnapshot = await this.readCanonical(runtime, now);
      this.queueLocalSync(runtime);

      // Coalesce rapid optimistic writes. Only the newest queued snapshot can
      // trigger a canonical UI replacement and native maintenance.
      if (generation === this.requestedWriteGeneration) {
        await this.runMaintenance(runtime);
        emitAtlasSnapshotInvalidation('local-save');
      }
    });
  }

  subscribeToSnapshotInvalidations(listener: () => void): () => void {
    return subscribeToAtlasSnapshotInvalidations(() => listener());
  }

  async connectGoogle(): Promise<AdapterActionResult> {
    return this.writeQueue.enqueue(async () => {
      const runtime = await this.runtime();
      const result = await runtime.sync.connect();
      this.syncState = await runtime.sync.state(false);
      if (result.ok) {
        this.canonicalSnapshot = await this.readCanonical(runtime);
        await this.runMaintenance(runtime);
        emitAtlasSnapshotInvalidation('remote-sync');
      }
      return result;
    });
  }

  async disconnectGoogle(): Promise<AdapterActionResult> {
    return this.writeQueue.enqueue(async () => {
      const runtime = await this.runtime();
      const result = await runtime.sync.disconnect();
      this.syncState = result.ok
        ? { status: 'local-only' }
        : await runtime.sync.state(false);
      this.canonicalSnapshot = await this.readCanonical(runtime);
      if (result.ok) emitAtlasSnapshotInvalidation('remote-sync');
      return result;
    });
  }

  async requestNotificationAccess(): Promise<AdapterActionResult> {
    try {
      await configureReminderCategoryAndChannelAsync();
      const existing = await Notifications.getPermissionsAsync();
      const permission = existing.granted
        ? existing
        : await Notifications.requestPermissionsAsync();
      if (!permission.granted) {
        return {
          ok: false,
          message:
            'Android no ha concedido las notificaciones. Puedes activarlas desde los ajustes de Atlas.',
        };
      }
      const runtime = await this.runtime();
      await this.runMaintenance(runtime, false);
      return {
        ok: true,
        message:
          'Notificaciones activadas. Los recordatorios permiten completar o posponer sin abrir Atlas.',
      };
    } catch (error) {
      return {
        ok: false,
        message: errorMessage(
          error,
          'No se pudo solicitar el permiso de notificaciones.',
        ),
      };
    }
  }

  async requestExactAlarmAccess(): Promise<AdapterActionResult> {
    try {
      const access = await getExactAlarmAccessAsync();
      if (access === 'granted' || access === 'not-applicable') {
        const runtime = await this.runtime();
        await this.runMaintenance(runtime, false);
        return {
          ok: true,
          message: 'Las alarmas exactas ya están activadas para Atlas.',
        };
      }
      await requestExactAlarmAccessAsync();
      return {
        ok: false,
        message:
          'Se han abierto los ajustes de Alarmas y recordatorios. Activa Atlas y vuelve a la aplicación.',
      };
    } catch (error) {
      return {
        ok: false,
        message: errorMessage(
          error,
          'No se pudieron abrir los ajustes de alarmas exactas.',
        ),
      };
    }
  }

  async checkForUpdate(): Promise<AdapterActionResult> {
    try {
      const update = await checkForAtlasUpdateAsync();
      if (update.status === 'up_to_date') {
        return {
          ok: true,
          message: `Atlas ${update.currentVersion} es la versión más reciente.`,
        };
      }
      if (!isNativeUpdaterAvailable()) {
        return {
          ok: false,
          message:
            'Hay una versión nueva, pero solo una APK nativa de Android puede instalarla.',
        };
      }
      if ((await getAtlasInstallPermissionAsync()) !== 'granted') {
        await requestAtlasInstallPermissionAsync();
        return {
          ok: false,
          message: `Atlas ${update.release.version} está disponible. Autoriza “Instalar aplicaciones desconocidas” y vuelve a comprobar la actualización.`,
        };
      }
      await installAtlasUpdateAsync(update.release);
      return {
        ok: true,
        message: `Atlas ${update.release.version} se ha descargado y verificado. Confirma ahora la instalación de Android.`,
      };
    } catch (error) {
      return {
        ok: false,
        message: errorMessage(
          error,
          'No se pudo comprobar GitHub Releases. Revisa la conexión e inténtalo de nuevo.',
        ),
      };
    }
  }
}

export const sqliteAtlasAppAdapter = new SQLiteAtlasAppAdapter();
