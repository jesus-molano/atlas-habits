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
import { useAtlasApp } from '@/features/atlas';
import { ChoiceChip, PageHeader, SettingRow } from '@/features/ui';

function showResult(title: string, ok: boolean, message: string) {
  Alert.alert(ok ? title : 'No disponible', message);
}

export function SettingsScreen() {
  const { mode, setMode } = useThemeContext();
  const {
    snapshot,
    connectGoogle,
    disconnectGoogle,
    requestNotificationAccess,
    requestExactAlarmAccess,
    checkForUpdate,
  } = useAtlasApp();
  const [pending, setPending] = useState<string | null>(null);
  const version = Application.nativeApplicationVersion ?? '0.1.0';

  const run = useCallback(
    async (
      id: string,
      title: string,
      action: () => Promise<{ ok: boolean; message: string }>,
    ) => {
      setPending(id);
      try {
        const result = await action();
        showResult(title, result.ok, result.message);
      } catch {
        showResult(
          title,
          false,
          'No se pudo completar la acción. Inténtalo de nuevo.',
        );
      } finally {
        setPending(null);
      }
    },
    [],
  );

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
          CUENTA Y SINCRONIZACIÓN
        </Text>
        <Card padding="sm" variant="default">
          <SettingRow
            description={
              snapshot.sync.status === 'connected'
                ? (snapshot.sync.accountEmail ?? 'Cuenta conectada')
                : 'Tus datos siguen disponibles sin conexión.'
            }
            icon={snapshot.sync.status === 'connected' ? Cloud : HardDrive}
            title={
              snapshot.sync.status === 'connected'
                ? 'Sincronización activa'
                : 'Solo en este dispositivo'
            }
            value={
              snapshot.sync.status === 'connecting' ? 'Conectando…' : undefined
            }
          />
          {snapshot.sync.status === 'connected' ? (
            <Button
              fullWidth
              label="Desconectar cuenta"
              leadingIcon={LogOut}
              loading={pending === 'disconnect'}
              onPress={() =>
                void run('disconnect', 'Cuenta desconectada', disconnectGoogle)
              }
              variant="secondary"
            />
          ) : (
            <Button
              fullWidth
              label="Continuar con Google"
              leadingIcon={Cloud}
              loading={pending === 'google'}
              onPress={() =>
                void run('google', 'Cuenta conectada', connectGoogle)
              }
            />
          )}
          <View style={styles.note}>
            <ShieldCheck size={17} />
            <Text style={styles.noteCopy} tone="secondary" variant="caption">
              La cuenta es opcional. Atlas no vende datos ni muestra anuncios.
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
            description="Permite completar o posponer desde la notificación."
            icon={BellRing}
            onPress={() =>
              void run(
                'notifications',
                'Recordatorios activados',
                requestNotificationAccess,
              )
            }
            title="Permiso de notificaciones"
            value={pending === 'notifications' ? 'Abriendo…' : undefined}
          />
          <SettingRow
            description="Necesario para avisar a la hora exacta con el móvil en reposo."
            icon={AlarmClockCheck}
            onPress={() =>
              void run(
                'alarms',
                'Alarmas exactas activadas',
                requestExactAlarmAccess,
              )
            }
            title="Alarmas exactas"
            value={pending === 'alarms' ? 'Abriendo…' : undefined}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <Text tone="muted" variant="eyebrow">
          ACTUALIZACIONES
        </Text>
        <Card padding="sm" variant="default">
          <SettingRow
            description="Busca una APK nueva en GitHub Releases y verifica su firma."
            icon={GitBranch}
            onPress={() =>
              void run('update', 'Atlas está al día', checkForUpdate)
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
        <Info size={20} />
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
