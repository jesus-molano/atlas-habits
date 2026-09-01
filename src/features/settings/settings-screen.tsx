import * as Application from 'expo-application';
import {
  AlarmClockCheck,
  BellRing,
  Cloud,
  GitBranch,
  HardDrive,
  Info,
  LogOut,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
} from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button, Card, Screen, Text } from '@/components/core';
import { useThemeContext } from '@/design';
import { useAtlasApp, type AdapterActionResult } from '@/features/atlas';
import { ChoiceChip, PageHeader, SettingRow } from '@/features/ui';

type ActionCopy = {
  successTitle: string;
  failureTitle: string;
  unexpectedMessage?: string;
};

function showResult(copy: ActionCopy, result: AdapterActionResult) {
  Alert.alert(
    result.ok ? copy.successTitle : copy.failureTitle,
    result.message,
  );
}

export function SettingsScreen() {
  const { mode, setMode, theme } = useThemeContext();
  const {
    snapshot,
    connectGoogle,
    disconnectGoogle,
    requestNotificationAccess,
    requestExactAlarmAccess,
    checkForUpdate,
  } = useAtlasApp();
  const [pending, setPending] = useState<string | null>(null);
  const [googleFailed, setGoogleFailed] = useState(false);
  const version = Application.nativeApplicationVersion ?? '0.1.1';

  const run = useCallback(
    async (
      id: string,
      copy: ActionCopy,
      action: () => Promise<AdapterActionResult>,
      onResult?: (result: AdapterActionResult) => void,
    ) => {
      setPending(id);
      try {
        const result = await action();
        onResult?.(result);
        showResult(copy, result);
      } catch {
        const result = {
          ok: false,
          message:
            copy.unexpectedMessage ??
            'No se pudo completar la acción. Inténtalo de nuevo.',
        } satisfies AdapterActionResult;
        onResult?.(result);
        showResult(copy, result);
      } finally {
        setPending(null);
      }
    },
    [],
  );

  const googleConnecting = pending === 'google';
  const googleError =
    googleFailed ||
    snapshot.sync.status === 'error' ||
    (snapshot.sync.status === 'connecting' && !googleConnecting);
  const syncConnected = snapshot.sync.status === 'connected';
  const syncTitle = syncConnected
    ? 'Sincronización activa'
    : googleConnecting
      ? 'Conectando con Google'
      : googleError
        ? 'Sincronización no activada'
        : 'Guardado en este dispositivo';
  const syncDescription = syncConnected
    ? (snapshot.sync.accountEmail ?? 'Cuenta de Google conectada')
    : googleConnecting
      ? 'Tus datos locales permanecen disponibles durante el proceso.'
      : googleError
        ? 'Puedes reintentarlo. Tus datos siguen guardados y la app funciona sin cuenta.'
        : 'La app funciona completa sin cuenta. Conecta Google solo para sincronizar dispositivos.';

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

      <View style={styles.section}>
        <Text tone="muted" variant="eyebrow">
          APARIENCIA
        </Text>
        <Card padding="lg" style={styles.cardGap} variant="default">
          <View>
            <Text variant="bodyStrong">Tema</Text>
            <Text tone="secondary" variant="caption">
              Atlas sigue el sistema si no eliges otro modo.
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
          CUENTA Y SINCRONIZACIÓN OPCIONAL
        </Text>
        <Card padding="sm" variant="default">
          <SettingRow
            description={syncDescription}
            icon={syncConnected ? Cloud : HardDrive}
            title={syncTitle}
            value={
              syncConnected
                ? 'Activa'
                : googleConnecting
                  ? 'Conectando…'
                  : 'Opcional'
            }
          />
          {syncConnected ? (
            <Button
              accessibilityHint="Detiene la sincronización; conserva los datos guardados en este dispositivo."
              disabled={pending !== null && pending !== 'disconnect'}
              fullWidth
              label="Desconectar cuenta"
              leadingIcon={LogOut}
              loading={pending === 'disconnect'}
              onPress={() =>
                void run(
                  'disconnect',
                  {
                    successTitle: 'Cuenta desconectada',
                    failureTitle: 'No se desconectó la cuenta',
                  },
                  disconnectGoogle,
                )
              }
              variant="secondary"
            />
          ) : (
            <Button
              accessibilityHint="Inicia sesión para sincronizar entre dispositivos. No es necesario para usar la app."
              disabled={pending !== null && pending !== 'google'}
              fullWidth
              label={
                googleError
                  ? 'Reintentar con Google'
                  : 'Activar sincronización con Google'
              }
              leadingIcon={Cloud}
              loading={pending === 'google'}
              onPress={() =>
                void run(
                  'google',
                  {
                    successTitle: 'Sincronización activada',
                    failureTitle: 'No se activó la sincronización',
                    unexpectedMessage:
                      'No se pudo abrir el acceso con Google. Tus datos siguen guardados en este dispositivo.',
                  },
                  connectGoogle,
                  (result) => setGoogleFailed(!result.ok),
                )
              }
            />
          )}
          <View style={styles.note}>
            <ShieldCheck color={theme.colors.success} size={17} />
            <Text style={styles.noteCopy} tone="secondary" variant="caption">
              No necesitas iniciar sesión. Google solo añade una copia
              sincronizada entre tus dispositivos.
            </Text>
          </View>
        </Card>
      </View>

      <View style={styles.section}>
        <Text tone="muted" variant="eyebrow">
          RECORDATORIOS
        </Text>
        <Card padding="sm" variant="default">
          <SettingRow
            accessibilityHint="Android pedirá el permiso o abrirá sus ajustes si debes activarlo allí."
            description="Permite completar o posponer desde la notificación. Android puede pedir que lo actives en Ajustes."
            disabled={pending !== null}
            icon={BellRing}
            onPress={() =>
              void run(
                'notifications',
                {
                  successTitle: 'Permiso de notificaciones',
                  failureTitle: 'Permiso de notificaciones',
                },
                requestNotificationAccess,
              )
            }
            title="Permiso de notificaciones"
            value={pending === 'notifications' ? 'Comprobando…' : undefined}
          />
          <SettingRow
            accessibilityHint="Comprueba el permiso y abre Alarmas y recordatorios si debes activarlo manualmente."
            description="Necesario para avisar a la hora exacta con el móvil en reposo. Puede requerir activación en Ajustes."
            disabled={pending !== null}
            icon={AlarmClockCheck}
            onPress={() =>
              void run(
                'alarms',
                {
                  successTitle: 'Alarmas exactas',
                  failureTitle: 'Alarmas exactas',
                },
                requestExactAlarmAccess,
              )
            }
            title="Alarmas exactas"
            value={pending === 'alarms' ? 'Comprobando…' : undefined}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <Text tone="muted" variant="eyebrow">
          ACTUALIZACIONES
        </Text>
        <Card padding="sm" variant="default">
          <SettingRow
            accessibilityHint="Busca una versión nueva y, si existe, ofrece instalarla desde GitHub Releases."
            description="Busca una APK nueva en GitHub Releases y verifica su firma."
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
            description="Código público, compilaciones reproducibles y sin pago recurrente."
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
        <Card padding="sm" variant="default">
          <SettingRow
            description="La base principal vive en tu teléfono. La nube solo transporta cambios si la activas."
            icon={HardDrive}
            title="Almacenamiento local-first"
          />
          <SettingRow
            description="Sin publicidad, analítica de terceros ni compras dentro de la app."
            icon={ShieldCheck}
            title="Privacidad por defecto"
          />
        </Card>
      </View>

      <Card padding="lg" style={styles.about} variant="outlined">
        <Info color={theme.colors.primary} size={20} />
        <View style={styles.aboutCopy}>
          <Text variant="bodyStrong">Atlas {version}</Text>
          <Text tone="secondary" variant="caption">
            Una herramienta personal para avanzar sin ruido.
          </Text>
        </View>
      </Card>
      <View style={styles.bottomSpace} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 24, paddingBottom: 112, paddingTop: 12 },
  section: { gap: 10 },
  cardGap: { gap: 16 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  note: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  noteCopy: { flex: 1 },
  about: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  aboutCopy: { flex: 1, gap: 2 },
  bottomSpace: { height: 12 },
});
