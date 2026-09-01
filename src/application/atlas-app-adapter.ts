import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Linking, Platform } from 'react-native';

import {
  createUuid,
  getCommandGateway,
  getDatabase,
  type CommandGateway,
} from '../data';
import { createEmptySnapshot } from '../features/atlas/empty-snapshot';
import type {
  AdapterActionResult,
  AtlasAppAdapter,
  AtlasDayMutation,
  AtlasDayView,
  AtlasSnapshot,
  ReminderCapability,
  SyncState,
} from '../features/atlas/types';
import { configureReminderCategoryAndChannelAsync } from '../platform/notifications';
import {
  checkForAtlasUpdateAsync,
  getAtlasInstallPermissionAsync,
  installAtlasUpdateAsync,
  isNativeUpdaterAvailable,
  requestAtlasInstallPermissionAsync,
} from '../platform/updater';
import { refreshAtlasWidgetsAsync } from '../widgets';

import { localDateFromDate } from './date-time';
import { changesForAtlasDayMutation } from './day-mutation';
import { getAtlasDeviceId } from './device-identity';
import { withoutLegacyStarterItems } from './legacy-starter-cleanup';
import { OptionalAtlasSync } from './optional-sync';
import { AtlasSnapshotWriter } from './persistence';
import {
  REMINDERS_ENABLED_STORAGE_KEY,
  rescheduleAtlasRemindersAsync,
} from './reminder-scheduler';
import {
  emitAtlasSnapshotInvalidation,
  subscribeToAtlasSnapshotInvalidations,
} from './runtime-events';
import { SerializedAsyncQueue } from './serial-queue';
import { diffAtlasSnapshots } from './snapshot-diff';
import {
  loadAtlasDayViewFromSQLite,
  loadAtlasSnapshotFromSQLite,
} from './snapshot-loader';
import { syncIssueFor } from './sync-error-copy';
import { atlasWidgetDataSource } from './widget-data-source';

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

export class SQLiteAtlasAppAdapter implements AtlasAppAdapter {
  private runtimePromise: Promise<SQLiteAtlasRuntime> | null = null;
  private readonly writeQueue = new SerializedAsyncQueue();
  private requestedWriteGeneration = 0;
  private syncState: SyncState = { status: 'local-only' };
  private canonicalSnapshot: AtlasSnapshot | null = null;
  private remindersEnabled = true;
  private reminderPreferenceLoaded = false;

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
    const snapshot =
      (await this.readRawCanonical(runtime, now)) ??
      createEmptySnapshot(this.syncState);
    return {
      ...snapshot,
      reminderCapability: await this.readReminderCapability(),
    };
  }

  private async loadReminderPreference(): Promise<boolean> {
    if (!this.reminderPreferenceLoaded) {
      const stored = await AsyncStorage.getItem(REMINDERS_ENABLED_STORAGE_KEY);
      this.remindersEnabled = stored !== 'false';
      this.reminderPreferenceLoaded = true;
    }
    return this.remindersEnabled;
  }

  private async readReminderCapability(): Promise<ReminderCapability> {
    const masterEnabled = await this.loadReminderPreference();
    if (Platform.OS !== 'android') {
      return {
        masterEnabled,
        notifications: 'not-applicable',
      };
    }
    const permission = await Notifications.getPermissionsAsync();
    return {
      masterEnabled,
      notifications: permission.granted
        ? 'granted'
        : permission.canAskAgain
          ? 'askable'
          : 'blocked',
    };
  }

  private async removeLegacyStarterItems(
    runtime: SQLiteAtlasRuntime,
    now: Date,
  ): Promise<void> {
    const previous = await this.readRawCanonical(runtime, now);
    if (!previous) return;
    const next = withoutLegacyStarterItems(previous);
    if (next === previous) return;
    const localDate = localDateFromDate(now);
    const changes = diffAtlasSnapshots(previous, next, localDate);
    if (changes.length === 0) return;
    await runtime.writer.applyChanges(changes, next, localDate);
  }

  private async runMaintenance(
    runtime: SQLiteAtlasRuntime,
    refreshWidgets = true,
  ): Promise<void> {
    const work: Promise<unknown>[] = [
      this.loadReminderPreference().then((enabled) =>
        this.reconcileReminders(runtime, enabled),
      ),
    ];
    if (refreshWidgets) {
      work.push(refreshAtlasWidgetsAsync(atlasWidgetDataSource));
    }
    await Promise.allSettled(work);
  }

  private reconcileReminders(runtime: SQLiteAtlasRuntime, enabled: boolean) {
    return rescheduleAtlasRemindersAsync({
      database: runtime.database,
      enabled,
    });
  }

  private recordSyncFailure(error: unknown): void {
    const { failure, issue } = syncIssueFor(error);
    this.syncState = {
      status: 'error',
      accountEmail: this.syncState.accountEmail,
      message: failure.message,
      issue,
    };
  }

  private queueLocalSync(runtime: SQLiteAtlasRuntime): void {
    void runtime.sync
      .syncNow('local_change')
      .then((summary) => {
        void this.writeQueue
          .enqueue(async () => {
            this.syncState = await runtime.sync.state(false);
            this.canonicalSnapshot = await this.readCanonical(runtime);
            if (summary.appliedMutations > 0) {
              await this.runMaintenance(runtime);
            }
            emitAtlasSnapshotInvalidation('remote-sync');
          })
          .catch(() => undefined);
      })
      .catch((error: unknown) => {
        void this.writeQueue
          .enqueue(async () => {
            this.recordSyncFailure(error);
            this.canonicalSnapshot = await this.readCanonical(runtime);
            emitAtlasSnapshotInvalidation('remote-sync');
          })
          .catch(() => undefined);
      });
  }

  async loadSnapshot(): Promise<AtlasSnapshot> {
    return this.writeQueue.enqueue(async () => {
      const runtime = await this.runtime();
      const now = new Date();
      // This migration must run before optional sync so its item deletions and
      // tombstones are uploaded instead of restoring v0.1.0 example records.
      await this.removeLegacyStarterItems(runtime, now);
      this.syncState = await runtime.sync.state(true);
      if (this.syncState.status === 'connected') {
        try {
          await runtime.sync.syncNow('foreground');
        } catch (error) {
          this.recordSyncFailure(error);
        }
      }
      this.canonicalSnapshot = await this.readCanonical(runtime, now);
      await this.runMaintenance(runtime);
      return this.canonicalSnapshot;
    });
  }

  async refreshSnapshot(): Promise<AtlasSnapshot> {
    return this.writeQueue.enqueue(async () => {
      const runtime = await this.runtime();
      this.canonicalSnapshot = await this.readCanonical(runtime);
      return this.canonicalSnapshot;
    });
  }

  async loadDay(localDate: string): Promise<AtlasDayView> {
    return this.writeQueue.enqueue(async () => {
      const runtime = await this.runtime();
      return loadAtlasDayViewFromSQLite({
        database: runtime.database,
        gateway: runtime.gateway,
        localDate,
        syncState: this.syncState,
      });
    });
  }

  async applyDayMutation(
    localDate: string,
    mutation: AtlasDayMutation,
  ): Promise<AtlasDayView> {
    return this.writeQueue.enqueue(async () => {
      const runtime = await this.runtime();
      const current = await loadAtlasDayViewFromSQLite({
        database: runtime.database,
        gateway: runtime.gateway,
        localDate,
        syncState: this.syncState,
      });
      const changes = changesForAtlasDayMutation(current, mutation);
      if (changes.length > 0) {
        await runtime.writer.applyChanges(
          changes,
          this.canonicalSnapshot ?? createEmptySnapshot(this.syncState),
          localDate as `${number}-${number}-${number}`,
        );
      }
      const next = await loadAtlasDayViewFromSQLite({
        database: runtime.database,
        gateway: runtime.gateway,
        localDate,
        syncState: this.syncState,
      });
      this.canonicalSnapshot = await this.readCanonical(runtime);
      this.queueLocalSync(runtime);
      emitAtlasSnapshotInvalidation('local-save');
      return next;
    });
  }

  async saveSnapshot(
    snapshot: AtlasSnapshot,
    requestedLocalDate?: string,
  ): Promise<void> {
    const generation = ++this.requestedWriteGeneration;
    await this.writeQueue.enqueue(async () => {
      const runtime = await this.runtime();
      const now = new Date();
      const previous = await this.readCanonical(runtime, now);
      const localDate = (requestedLocalDate ??
        localDateFromDate(now)) as `${number}-${number}-${number}`;
      const changes = diffAtlasSnapshots(previous, snapshot, localDate);
      if (changes.length > 0) {
        await runtime.writer.applyChanges(changes, snapshot, localDate);
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
      if (result.ok) {
        const state = await runtime.sync.state(false);
        this.syncState = result.syncIssue
          ? {
              ...state,
              message: result.message,
              issue: result.syncIssue,
            }
          : state;
      } else {
        this.syncState = {
          status: 'error',
          message: result.message,
          issue: result.syncIssue,
        };
      }
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
      if (!existing.granted && !existing.canAskAgain) {
        await Linking.openSettings();
        return {
          ok: false,
          code: 'settings-opened',
          message:
            'Se han abierto los ajustes de Atlas. Activa Notificaciones y vuelve a la aplicación.',
        };
      }
      const permission = existing.granted
        ? existing
        : await Notifications.requestPermissionsAsync();
      if (!permission.granted) {
        if (!permission.canAskAgain) {
          await Linking.openSettings();
          return {
            ok: false,
            code: 'settings-opened',
            message:
              'Se han abierto los ajustes de Atlas. Activa Notificaciones y vuelve a la aplicación.',
          };
        }
        return {
          ok: false,
          code: 'permission-denied',
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

  async setRemindersEnabled(enabled: boolean): Promise<AdapterActionResult> {
    if (enabled) {
      const permission = await Notifications.getPermissionsAsync();
      if (!permission.granted) {
        const access = await this.requestNotificationAccess();
        if (!access.ok) return access;
      }
    }
    try {
      await AsyncStorage.setItem(
        REMINDERS_ENABLED_STORAGE_KEY,
        String(enabled),
      );
      this.remindersEnabled = enabled;
      this.reminderPreferenceLoaded = true;
    } catch (error) {
      return {
        ok: false,
        code: 'storage-failed',
        message: errorMessage(
          error,
          'No se pudo cambiar el estado de los recordatorios.',
        ),
      };
    }
    try {
      const runtime = await this.runtime();
      await this.reconcileReminders(runtime, enabled);
      this.canonicalSnapshot = await this.readCanonical(runtime);
      emitAtlasSnapshotInvalidation('local-save');
      return {
        ok: true,
        message: enabled
          ? 'Los recordatorios de Atlas están activos en este dispositivo.'
          : 'Los recordatorios de Atlas están pausados en este dispositivo.',
      };
    } catch {
      emitAtlasSnapshotInvalidation('local-save');
      return {
        ok: false,
        code: 'reminder-reconcile-failed',
        message:
          'La preferencia quedó guardada, pero Android no confirmó todos los avisos. Reintenta.',
      };
    }
  }

  private async refreshAfterTimerCommand(
    runtime: SQLiteAtlasRuntime,
    shouldSync: boolean,
  ): Promise<void> {
    this.canonicalSnapshot = await this.readCanonical(runtime);
    if (shouldSync) this.queueLocalSync(runtime);
    emitAtlasSnapshotInvalidation('local-save');
  }

  async startTimer(itemId: string): Promise<AdapterActionResult> {
    return this.writeQueue.enqueue(async () => {
      try {
        const runtime = await this.runtime();
        await runtime.gateway.progress.startTimer({ itemId });
        await this.refreshAfterTimerCommand(runtime, false);
        return { ok: true, message: 'Cronómetro iniciado.' };
      } catch (error) {
        return {
          ok: false,
          code: 'already-active',
          message: errorMessage(error, 'No se pudo iniciar el cronómetro.'),
        };
      }
    });
  }

  async pauseTimer(): Promise<AdapterActionResult> {
    return this.writeQueue.enqueue(async () => {
      try {
        const runtime = await this.runtime();
        await runtime.gateway.progress.pauseTimer();
        await this.refreshAfterTimerCommand(runtime, false);
        return { ok: true, message: 'Cronómetro pausado.' };
      } catch (error) {
        return {
          ok: false,
          message: errorMessage(error, 'No se pudo pausar.'),
        };
      }
    });
  }

  async resumeTimer(): Promise<AdapterActionResult> {
    return this.writeQueue.enqueue(async () => {
      try {
        const runtime = await this.runtime();
        await runtime.gateway.progress.resumeTimer();
        await this.refreshAfterTimerCommand(runtime, false);
        return { ok: true, message: 'Cronómetro reanudado.' };
      } catch (error) {
        return {
          ok: false,
          message: errorMessage(error, 'No se pudo reanudar.'),
        };
      }
    });
  }

  async stopTimer(localDate: string): Promise<AdapterActionResult> {
    return this.writeQueue.enqueue(async () => {
      try {
        const runtime = await this.runtime();
        const result = await runtime.gateway.progress.stopTimer({
          commandId: createUuid(),
          deviceId: runtime.deviceId,
          issuedAt: Date.now(),
          payload: { localDate },
        });
        await this.refreshAfterTimerCommand(runtime, true);
        const minutes = Math.max(
          1,
          Math.round(result.value.elapsedSeconds / 60),
        );
        return {
          ok: true,
          message: `${minutes} min guardados en el historial.`,
        };
      } catch (error) {
        return {
          ok: false,
          message: errorMessage(error, 'No se pudo guardar la sesión.'),
        };
      }
    });
  }

  async cancelTimer(): Promise<AdapterActionResult> {
    return this.writeQueue.enqueue(async () => {
      try {
        const runtime = await this.runtime();
        await runtime.gateway.progress.cancelTimer();
        await this.refreshAfterTimerCommand(runtime, false);
        return { ok: true, message: 'Sesión descartada.' };
      } catch (error) {
        return {
          ok: false,
          message: errorMessage(error, 'No se pudo cancelar la sesión.'),
        };
      }
    });
  }

  async recordManualDuration(
    itemId: string,
    seconds: number,
    localDate: string,
  ): Promise<AdapterActionResult> {
    return this.writeQueue.enqueue(async () => {
      try {
        const runtime = await this.runtime();
        await runtime.gateway.progress.recordManualDuration({
          commandId: createUuid(),
          deviceId: runtime.deviceId,
          issuedAt: Date.now(),
          payload: { itemId, seconds, localDate },
        });
        await this.refreshAfterTimerCommand(runtime, true);
        return {
          ok: true,
          message: `${Math.max(1, Math.round(seconds / 60))} min añadidos.`,
        };
      } catch (error) {
        return {
          ok: false,
          code: 'invalid-target',
          message: errorMessage(error, 'No se pudo guardar el tiempo.'),
        };
      }
    });
  }

  async resolveLegacyTimers(
    itemId: string | null,
  ): Promise<AdapterActionResult> {
    return this.writeQueue.enqueue(async () => {
      try {
        const runtime = await this.runtime();
        await runtime.gateway.progress.resolveLegacyTimers(itemId);
        await this.refreshAfterTimerCommand(runtime, false);
        return {
          ok: true,
          message: itemId
            ? 'Sesión recuperada.'
            : 'Sesiones antiguas descartadas.',
        };
      } catch (error) {
        return {
          ok: false,
          message: errorMessage(
            error,
            'No se pudo resolver la sesión antigua.',
          ),
        };
      }
    });
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
