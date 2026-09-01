import * as Application from 'expo-application';
import {
  BellRing,
  CalendarCheck,
  Cloud,
  GitBranch,
  HardDrive,
  Info,
  ListTodo,
  LogOut,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
} from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { requestPinWidget } from 'react-native-android-widget';

import { Button, Card, Screen, Text } from '@/components/core';
import {
  FeedbackSheet,
  InlineFeedback,
} from '@/components/core/feedback-overlay';
import { useThemeContext } from '@/design';
import { useAtlasApp, type AdapterActionResult } from '@/features/atlas';
import { ChoiceChip, PageHeader, SettingRow } from '@/features/ui';
import { ATLAS_WIDGET_NAMES } from '@/widgets';

type ActionCopy = Readonly<{
  successTitle: string;
  failureTitle: string;
  unexpectedMessage?: string;
}>;

type WidgetFeedback = Readonly<{
  title: string;
  message: string;
  tone: 'neutral' | 'danger';
}>;

function syncIssueTitle(kind?: string): string {
  if (kind === 'firestore-permission') return 'Firestore rechazó esta cuenta';
  if (kind === 'firestore-setup') return 'Firestore aún no está listo';
  if (kind === 'network') return 'Sin conexión para sincronizar';
  if (kind === 'credentials-configuration')
    return 'Configuración de Google incompleta';
  if (kind === 'google-provider-disabled') return 'Google no está habilitado';
  return 'La sincronización no se ha activado';
}

export function SettingsScreen() {
  const { mode, setMode, theme } = useThemeContext();
  const {
    snapshot,
    connectGoogle,
    disconnectGoogle,
    requestNotificationAccess,
    setRemindersEnabled,
    checkForUpdate,
  } = useAtlasApp();
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<
    (AdapterActionResult & { title: string }) | null
  >(null);
  const [widgetFeedback, setWidgetFeedback] = useState<WidgetFeedback | null>(
    null,
  );
  const [reminderSheetOpen, setReminderSheetOpen] = useState(false);
  const [awaitingSystemSettings, setAwaitingSystemSettings] = useState<
    'notifications' | 'notification-master' | null
  >(null);
  const version = Application.nativeApplicationVersion ?? '0.1.3';
  const capability = snapshot.reminderCapability ?? {
    masterEnabled: true,
    notifications: 'askable' as const,
  };

  const run = useCallback(
    async (
      id: string,
      copy: ActionCopy,
      action: () => Promise<AdapterActionResult>,
    ) => {
      setPending(id);
      try {
        const result = await action();
        const settingsTarget: 'notifications' | 'notification-master' | null =
          id === 'reminder-master'
            ? 'notification-master'
            : id === 'notifications'
              ? 'notifications'
              : null;
        if (result.code === 'settings-opened' && settingsTarget !== null) {
          setAwaitingSystemSettings(settingsTarget);
          setFeedback(null);
          return result;
        }
        if (settingsTarget !== null) setAwaitingSystemSettings(null);
        setFeedback({
          ...result,
          title: result.ok ? copy.successTitle : copy.failureTitle,
        });
        return result;
      } catch {
        const result: AdapterActionResult = {
          ok: false,
          message:
            copy.unexpectedMessage ??
            'No se pudo completar la acción. Inténtalo de nuevo.',
        };
        setFeedback({ ...result, title: copy.failureTitle });
        return result;
      } finally {
        setPending(null);
      }
    },
    [],
  );

  const syncConnected = snapshot.sync.status === 'connected';
  const googleConnecting = pending === 'google';
  const syncTitle = syncConnected
    ? 'Sincronización activa'
    : googleConnecting
      ? 'Conectando con Google'
      : 'Guardado local';
  const syncDescription = syncConnected
    ? (snapshot.sync.accountEmail ?? 'Cuenta de Google conectada')
    : 'Atlas funciona sin cuenta. Google solo añade sincronización entre dispositivos.';
  const notificationLabel =
    capability.notifications === 'granted'
      ? 'Permitidas'
      : capability.notifications === 'blocked'
        ? 'Bloqueadas'
        : capability.notifications === 'not-applicable'
          ? 'No aplicable'
          : 'Pendientes';
  const systemSettingsReady =
    (awaitingSystemSettings === 'notifications' ||
      awaitingSystemSettings === 'notification-master') &&
    (capability.notifications === 'granted' ||
      capability.notifications === 'not-applicable');

  const requestWidgetPin = useCallback(async (widgetName: string) => {
    const id = `widget-${widgetName}`;
    setPending(id);
    setWidgetFeedback(null);
    try {
      const accepted = await requestPinWidget({ widgetName });
      setWidgetFeedback(
        accepted
          ? {
              title: 'Solicitud abierta',
              message:
                'El launcher ha aceptado la solicitud. Confírmala para añadir el widget a la pantalla de inicio.',
              tone: 'neutral',
            }
          : {
              title: 'Añádelo desde la pantalla de inicio',
              message:
                'Este launcher no admite la solicitud desde Atlas. Mantén pulsada una zona vacía de la pantalla de inicio y busca Atlas en Widgets.',
              tone: 'neutral',
            },
      );
    } catch {
      setWidgetFeedback({
        title: 'No se pudo abrir el selector',
        message:
          'Prueba a añadir el widget desde el selector de Widgets de la pantalla de inicio.',
        tone: 'danger',
      });
    } finally {
      setPending(null);
    }
  }, []);

  return (
    <Screen
      contentContainerStyle={styles.content}
      safeAreaEdges={['top', 'left', 'right']}
      scroll
    >
      <PageHeader
        description="Control local, permisos claros y sincronización voluntaria."
        eyebrow="Control"
        title="Ajustes"
      />

      {feedback ? (
        <InlineFeedback
          message={feedback.message}
          onClose={() => setFeedback(null)}
          title={feedback.title}
          tone={feedback.ok ? 'success' : 'danger'}
        />
      ) : null}

      <View style={styles.section}>
        <Text tone="muted" variant="eyebrow">
          APARIENCIA
        </Text>
        <Card padding="md" style={styles.cardGap}>
          <View>
            <Text variant="bodyStrong">Tema</Text>
            <Text tone="secondary" variant="caption">
              Usa el sistema o fija un modo.
            </Text>
          </View>
          <View accessibilityRole="radiogroup" style={styles.choices}>
            <ChoiceChip
              icon={Moon}
              label="Oscuro"
              onPress={() => setMode('dark')}
              selected={mode === 'dark'}
            />
            <ChoiceChip
              icon={Sun}
              label="Claro"
              onPress={() => setMode('light')}
              selected={mode === 'light'}
            />
            <ChoiceChip
              label="Sistema"
              onPress={() => setMode('system')}
              selected={mode === 'system'}
            />
          </View>
        </Card>
      </View>

      <View style={styles.section}>
        <Text tone="muted" variant="eyebrow">
          CUENTA
        </Text>
        <Card padding="sm">
          <SettingRow
            description={syncDescription}
            icon={syncConnected ? Cloud : HardDrive}
            title={syncTitle}
            value={syncConnected ? 'Activa' : 'Opcional'}
          />
          {snapshot.sync.status === 'error' || snapshot.sync.issue ? (
            <InlineFeedback
              message={
                snapshot.sync.message ??
                'Tus datos siguen guardados en este dispositivo.'
              }
              title={syncIssueTitle(snapshot.sync.issue?.kind)}
              tone={
                snapshot.sync.issue?.kind === 'network' ? 'warning' : 'danger'
              }
            />
          ) : null}
          <Button
            accessibilityHint={
              syncConnected
                ? 'Conserva los datos locales.'
                : 'La cuenta es opcional.'
            }
            disabled={pending !== null}
            fullWidth
            label={syncConnected ? 'Desconectar cuenta' : 'Conectar Google'}
            leadingIcon={syncConnected ? LogOut : Cloud}
            loading={pending === (syncConnected ? 'disconnect' : 'google')}
            onPress={() =>
              void run(
                syncConnected ? 'disconnect' : 'google',
                syncConnected
                  ? {
                      successTitle: 'Cuenta desconectada',
                      failureTitle: 'No se desconectó la cuenta',
                    }
                  : {
                      successTitle: 'Sincronización activada',
                      failureTitle: 'No se activó la sincronización',
                    },
                syncConnected ? disconnectGoogle : connectGoogle,
              )
            }
            variant={syncConnected ? 'secondary' : 'primary'}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <Text tone="muted" variant="eyebrow">
          RECORDATORIOS
        </Text>
        <Card padding="sm">
          <SettingRow
            accessibilityHint="Abre el control local y los permisos necesarios."
            description={`${notificationLabel}. Android puede entregarlos con un pequeño retraso.`}
            icon={BellRing}
            onPress={() => setReminderSheetOpen(true)}
            title="Recordatorios de Atlas"
            value={capability.masterEnabled ? 'Activos' : 'Pausados'}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <Text tone="muted" variant="eyebrow">
          PANTALLA DE INICIO
        </Text>
        <Card padding="sm">
          <SettingRow
            accessibilityHint="Abre la solicitud de Android para añadir el resumen de hoy."
            description="Resumen de hábitos completados hoy."
            disabled={pending !== null}
            icon={CalendarCheck}
            onPress={() => void requestWidgetPin(ATLAS_WIDGET_NAMES.progress)}
            title="Progreso de hoy"
            value={
              pending === `widget-${ATLAS_WIDGET_NAMES.progress}`
                ? 'Abriendo…'
                : 'Añadir'
            }
          />
          <SettingRow
            accessibilityHint="Abre la solicitud de Android para añadir hábitos a la pantalla de inicio."
            description="Marca hábitos sin abrir Atlas."
            disabled={pending !== null}
            icon={ListTodo}
            onPress={() => void requestWidgetPin(ATLAS_WIDGET_NAMES.habits)}
            title="Hábitos de hoy"
            value={
              pending === `widget-${ATLAS_WIDGET_NAMES.habits}`
                ? 'Abriendo…'
                : 'Añadir'
            }
          />
          <SettingRow
            accessibilityHint="Abre la solicitud de Android para añadir próximas tareas a la pantalla de inicio."
            description="Consulta las tareas que vienen."
            disabled={pending !== null}
            icon={GitBranch}
            onPress={() => void requestWidgetPin(ATLAS_WIDGET_NAMES.tasks)}
            title="Próximas tareas"
            value={
              pending === `widget-${ATLAS_WIDGET_NAMES.tasks}`
                ? 'Abriendo…'
                : 'Añadir'
            }
          />
          {widgetFeedback ? (
            <InlineFeedback
              message={widgetFeedback.message}
              onClose={() => setWidgetFeedback(null)}
              title={widgetFeedback.title}
              tone={widgetFeedback.tone}
            />
          ) : null}
        </Card>
      </View>

      <View style={styles.section}>
        <Text tone="muted" variant="eyebrow">
          ACTUALIZACIONES
        </Text>
        <Card padding="sm">
          <SettingRow
            description="Busca una APK nueva y verifica su firma."
            disabled={pending !== null}
            icon={GitBranch}
            onPress={() =>
              void run(
                'update',
                {
                  successTitle: 'Actualizaciones de Atlas',
                  failureTitle: 'No se pudo actualizar',
                },
                checkForUpdate,
              )
            }
            title="Comprobar actualización"
            value={pending === 'update' ? 'Buscando…' : `v${version}`}
          />
          <SettingRow
            description="Código público y compilaciones reproducibles."
            icon={RefreshCw}
            title="Canal de versiones"
            value="GitHub"
          />
        </Card>
      </View>

      <View style={styles.section}>
        <Text tone="muted" variant="eyebrow">
          DATOS Y PRIVACIDAD
        </Text>
        <Card padding="sm">
          <SettingRow
            description="La base principal vive en tu teléfono."
            icon={HardDrive}
            title="Almacenamiento local-first"
          />
          <SettingRow
            description="Sin publicidad ni analítica de terceros."
            icon={ShieldCheck}
            title="Privacidad por defecto"
          />
        </Card>
      </View>

      <Card padding="md" style={styles.about} variant="outlined">
        <Info color={theme.colors.primary} size={20} />
        <View style={styles.aboutCopy}>
          <Text variant="bodyStrong">Atlas {version}</Text>
          <Text tone="secondary" variant="caption">
            Una herramienta personal para avanzar sin ruido.
          </Text>
        </View>
      </Card>

      <FeedbackSheet
        message="El interruptor es local a este dispositivo. Al pausarlo, Atlas cancela sus avisos sin borrar la configuración de cada hábito o tarea."
        onClose={() => {
          setAwaitingSystemSettings(null);
          setReminderSheetOpen(false);
        }}
        title="Gestionar recordatorios"
        visible={reminderSheetOpen}
      >
        <View style={styles.permissionList}>
          {awaitingSystemSettings ? (
            <InlineFeedback
              message={
                systemSettingsReady &&
                awaitingSystemSettings === 'notification-master'
                  ? 'Android ya permite las notificaciones. Los recordatorios siguen pausados; pulsa «Activar recordatorios en este dispositivo» para programarlos.'
                  : systemSettingsReady
                    ? 'Atlas ha comprobado el permiso al volver desde Android.'
                    : awaitingSystemSettings === 'notifications' ||
                        awaitingSystemSettings === 'notification-master'
                      ? 'Activa Notificaciones en Android y vuelve a Atlas. El estado se comprobará de nuevo.'
                      : 'Activa Notificaciones en Android y vuelve a Atlas. El estado se comprobará de nuevo.'
              }
              onClose={() => setAwaitingSystemSettings(null)}
              title={
                systemSettingsReady &&
                awaitingSystemSettings === 'notification-master'
                  ? 'Permiso listo; falta activar'
                  : systemSettingsReady
                    ? 'Permiso activado'
                    : 'Completa el permiso en Android'
              }
              tone={systemSettingsReady ? 'success' : 'neutral'}
            />
          ) : null}
          <View style={styles.permissionRow}>
            <BellRing color={theme.colors.primary} size={20} />
            <View style={styles.permissionCopy}>
              <Text variant="label">Notificaciones</Text>
              <Text tone="secondary" variant="caption">
                {notificationLabel}
              </Text>
            </View>
            {capability.notifications !== 'granted' &&
            capability.notifications !== 'not-applicable' ? (
              <Button
                label={
                  capability.notifications === 'blocked'
                    ? 'Ajustes'
                    : 'Permitir'
                }
                loading={pending === 'notifications'}
                onPress={() =>
                  void run(
                    'notifications',
                    {
                      successTitle: 'Notificaciones activadas',
                      failureTitle: 'Notificaciones no activadas',
                    },
                    requestNotificationAccess,
                  )
                }
                size="sm"
                variant="secondary"
              />
            ) : null}
          </View>
          <Button
            fullWidth
            label={
              capability.masterEnabled
                ? 'Pausar recordatorios en este dispositivo'
                : 'Activar recordatorios en este dispositivo'
            }
            loading={pending === 'reminder-master'}
            onPress={() =>
              void run(
                'reminder-master',
                {
                  successTitle: capability.masterEnabled
                    ? 'Recordatorios pausados'
                    : 'Recordatorios activados',
                  failureTitle: 'No se actualizaron todos los avisos',
                },
                () => setRemindersEnabled(!capability.masterEnabled),
              )
            }
            variant={capability.masterEnabled ? 'secondary' : 'primary'}
          />
        </View>
      </FeedbackSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 18, paddingBottom: 148, paddingTop: 8 },
  section: { gap: 8 },
  cardGap: { gap: 14 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  about: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  aboutCopy: { flex: 1, gap: 2 },
  permissionList: { gap: 10 },
  permissionRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  permissionCopy: { flex: 1, gap: 1 },
});
