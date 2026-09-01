import { Tabs, useRouter } from 'expo-router';
import {
  BarChart3,
  CalendarDays,
  ListTodo,
  Pause,
  Play,
  Plus,
  Settings,
  Square,
  Timer,
  Trash2,
} from 'lucide-react-native';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import {
  Keyboard,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/core';
import {
  AtlasCalendarSheet,
  FeedbackSheet,
  InlineFeedback,
} from '@/components/core/feedback-overlay';
import { useTheme } from '@/design';
import { useAtlasApp, type AdapterActionResult } from '@/features/atlas';
import { runSingleFlight } from '@/features/atlas/single-flight';
import { ChoiceChip } from '@/features/ui';

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function durationLabel(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remainder = safe % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function tabBarExtraHeight(fontScale: number): number {
  return Math.round(Math.max(0, Math.min(fontScale, 2) - 1) * 18);
}

function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(Keyboard.isVisible());
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () =>
      setVisible(true),
    );
    const hidden = Keyboard.addListener('keyboardDidHide', () =>
      setVisible(false),
    );
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return visible;
}

function useElapsedSeconds() {
  const { snapshot } = useAtlasApp();
  const timer = snapshot.activeTimer;
  const timerKey = timer ? `${timer.itemId}:${timer.startedAt}` : '';
  const [liveElapsed, setLiveElapsed] = useState({ timerKey: '', seconds: 0 });
  useEffect(() => {
    if (!timer?.runningSince) return;
    const update = () => {
      setLiveElapsed({
        timerKey,
        seconds:
          timer.elapsedSeconds +
          Math.max(0, Math.floor((Date.now() - timer.runningSince!) / 1_000)),
      });
    };
    const initialUpdate = setTimeout(update, 0);
    const interval = setInterval(update, 1_000);
    return () => {
      clearTimeout(initialUpdate);
      clearInterval(interval);
    };
  }, [timer?.elapsedSeconds, timer?.runningSince, timerKey]);
  if (!timer) return 0;
  if (!timer.runningSince || liveElapsed.timerKey !== timerKey)
    return timer.elapsedSeconds;
  return Math.max(timer.elapsedSeconds, liveElapsed.seconds);
}

function GlobalTimerSurface() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const {
    snapshot,
    selectedDate,
    timerSheetOpen,
    timerTargetId,
    openTimerSheet,
    closeTimerSheet,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    cancelTimer,
    recordManualDuration,
    resolveLegacyTimers,
  } = useAtlasApp();
  const timer = snapshot.activeTimer;
  const elapsedSeconds = useElapsedSeconds();
  const candidates = useMemo(
    () => [
      ...snapshot.habits.filter((habit) => habit.metric === 'duration'),
      ...snapshot.tasks,
    ],
    [snapshot.habits, snapshot.tasks],
  );
  const [selectedItemOverride, setSelectedItemOverride] = useState<
    string | undefined
  >();
  const [minutes, setMinutes] = useState(25);
  const [manualDateOverride, setManualDateOverride] = useState<
    string | undefined
  >();
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [feedback, setFeedback] = useState<AdapterActionResult | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const actionLock = useRef(false);
  const legacyItems = (snapshot.legacyTimerItemIds ?? [])
    .map((id) => snapshot.habits.find((habit) => habit.id === id))
    .filter((habit): habit is NonNullable<typeof habit> => Boolean(habit));

  useEffect(() => {
    if (legacyItems.length > 1 && !timer) openTimerSheet();
  }, [legacyItems.length, openTimerSheet, timer]);

  const run = (id: string, operation: () => Promise<AdapterActionResult>) =>
    runSingleFlight(actionLock, async () => {
      setPendingAction(id);
      try {
        const result = await operation();
        setFeedback(result);
        return result;
      } finally {
        setPendingAction(null);
      }
    });
  const selectedItemId = candidates.some(
    (item) => item.id === selectedItemOverride,
  )
    ? selectedItemOverride
    : (timerTargetId ?? timer?.itemId ?? candidates[0]?.id);
  const manualDate = manualDateOverride ?? selectedDate;
  const manualDateIsHistorical = manualDate < dateKey(new Date());
  const selected = candidates.find((item) => item.id === selectedItemId);
  const close = () => {
    setFeedback(null);
    setSelectedItemOverride(undefined);
    setManualDateOverride(undefined);
    setShowDatePicker(false);
    closeTimerSheet();
  };

  return (
    <>
      {timer ? (
        <Pressable
          accessibilityHint="Abre los controles del cronómetro"
          accessibilityLabel={`${timer.title}, ${durationLabel(elapsedSeconds)}, ${timer.runningSince ? 'en marcha' : 'pausado'}`}
          accessibilityRole="button"
          onPress={() => openTimerSheet(timer.itemId)}
          style={({ pressed }) => [
            styles.miniTimer,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.borderStrong,
              bottom:
                Math.max(insets.bottom, 8) + 78 + tabBarExtraHeight(fontScale),
            },
            theme.shadows.floating,
            pressed && styles.miniTimerPressed,
          ]}
        >
          <Timer color={theme.colors.primary} size={21} strokeWidth={2.3} />
          <View style={styles.miniTimerCopy}>
            <Text numberOfLines={1} variant="label">
              {timer.title}
            </Text>
            <Text tone="secondary" variant="caption">
              {timer.runningSince ? 'En marcha' : 'Pausado'}
            </Text>
          </View>
          <Text style={styles.timerDigits} variant="bodyStrong">
            {durationLabel(elapsedSeconds)}
          </Text>
        </Pressable>
      ) : null}

      <FeedbackSheet
        closeLabel="Cerrar cronómetro"
        message={
          legacyItems.length > 1 && !timer
            ? 'Había varias sesiones antiguas activas. Elige una para recuperarla o descártalas; Atlas no decidirá por ti.'
            : timer
              ? 'La sesión sigue disponible al cambiar de pestaña o cerrar esta hoja.'
              : manualDateIsHistorical
                ? 'En una fecha anterior puedes añadir tiempo manual. Un cronómetro siempre empieza en el momento actual.'
                : 'Elige un hábito de duración o una tarea. El tiempo de una tarea no la marca como completada.'
        }
        onClose={close}
        title={
          legacyItems.length > 1 && !timer
            ? 'Recuperar sesión'
            : timer
              ? timer.title
              : 'Cronómetro y tiempo manual'
        }
        tone={feedback && !feedback.ok ? 'danger' : 'neutral'}
        visible={timerSheetOpen && !showDatePicker}
      >
        {feedback ? (
          <InlineFeedback
            message={feedback.message}
            onClose={() => setFeedback(null)}
            title={feedback.ok ? 'Hecho' : 'No se pudo completar'}
            tone={feedback.ok ? 'success' : 'danger'}
          />
        ) : null}

        {legacyItems.length > 1 && !timer ? (
          <View style={styles.timerSection}>
            {legacyItems.map((habit) => (
              <Button
                disabled={pendingAction !== null}
                fullWidth
                key={habit.id}
                label={`Recuperar ${habit.title}`}
                loading={pendingAction === `legacy-${habit.id}`}
                onPress={() =>
                  void run(`legacy-${habit.id}`, () =>
                    resolveLegacyTimers(habit.id),
                  )
                }
                variant="secondary"
              />
            ))}
            <Button
              disabled={pendingAction !== null}
              fullWidth
              label="Descartar sesiones antiguas"
              leadingIcon={Trash2}
              loading={pendingAction === 'legacy-discard'}
              onPress={() =>
                void run('legacy-discard', () => resolveLegacyTimers(null))
              }
              variant="danger"
            />
          </View>
        ) : timer ? (
          <View style={styles.timerSection}>
            <Text
              align="center"
              style={styles.sheetTimerDigits}
              variant="metric"
            >
              {durationLabel(elapsedSeconds)}
            </Text>
            <View style={styles.timerActions}>
              <Button
                disabled={pendingAction !== null}
                fullWidth
                label={timer.runningSince ? 'Pausar' : 'Reanudar'}
                leadingIcon={timer.runningSince ? Pause : Play}
                loading={pendingAction === 'timer-toggle'}
                onPress={() =>
                  void run(
                    'timer-toggle',
                    timer.runningSince ? pauseTimer : resumeTimer,
                  )
                }
                variant="secondary"
              />
              <Button
                disabled={pendingAction !== null}
                fullWidth
                label="Detener y guardar"
                leadingIcon={Square}
                loading={pendingAction === 'timer-stop'}
                onPress={() =>
                  void run('timer-stop', () =>
                    stopTimer(dateKey(new Date())),
                  ).then((result) => result?.ok && close())
                }
              />
              <Button
                disabled={pendingAction !== null}
                fullWidth
                label="Cancelar sin guardar"
                leadingIcon={Trash2}
                loading={pendingAction === 'timer-cancel'}
                onPress={() => void run('timer-cancel', cancelTimer)}
                variant="danger"
              />
            </View>
          </View>
        ) : (
          <View style={styles.timerSection}>
            {candidates.length > 0 ? (
              <View accessibilityRole="radiogroup" style={styles.choiceWrap}>
                {candidates.map((item) => (
                  <ChoiceChip
                    disabled={pendingAction !== null}
                    key={item.id}
                    label={item.title}
                    onPress={() => setSelectedItemOverride(item.id)}
                    selected={item.id === selectedItemId}
                  />
                ))}
              </View>
            ) : (
              <InlineFeedback
                message="Crea un hábito medido por tiempo o una tarea para empezar."
                title="No hay elementos compatibles"
              />
            )}
            {manualDateIsHistorical ? (
              <InlineFeedback
                message="La fecha elegida se aplicará al registro manual. Para medir tiempo en directo, vuelve a Hoy."
                title="Registro histórico"
              />
            ) : (
              <Button
                disabled={!selected || pendingAction !== null}
                fullWidth
                label="Iniciar cronómetro"
                leadingIcon={Play}
                loading={pendingAction === 'timer-start'}
                onPress={() =>
                  selected &&
                  void run('timer-start', () => startTimer(selected.id))
                }
              />
            )}
            <View style={styles.manualHeader}>
              <View style={styles.miniTimerCopy}>
                <Text variant="bodyStrong">Añadir tiempo manual</Text>
                <Text tone="secondary" variant="caption">
                  Selecciona minutos y fecha.
                </Text>
              </View>
              <Text tone="accent" variant="bodyStrong">
                {minutes} min
              </Text>
            </View>
            <View style={styles.choiceWrap}>
              {[5, 10, 15, 25, 30, 45, 60].map((value) => (
                <ChoiceChip
                  disabled={pendingAction !== null}
                  key={value}
                  label={`${value} min`}
                  onPress={() => setMinutes(value)}
                  selected={minutes === value}
                />
              ))}
            </View>
            <View style={styles.stepper}>
              <Button
                accessibilityLabel="Restar cinco minutos"
                disabled={pendingAction !== null}
                label="− 5"
                onPress={() => setMinutes((value) => Math.max(1, value - 5))}
                size="sm"
                variant="secondary"
              />
              <Button
                accessibilityLabel="Sumar cinco minutos"
                disabled={pendingAction !== null}
                label="+ 5"
                onPress={() => setMinutes((value) => Math.min(720, value + 5))}
                size="sm"
                variant="secondary"
              />
            </View>
            <Button
              disabled={pendingAction !== null}
              fullWidth
              label={`Fecha: ${new Date(`${manualDate}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`}
              leadingIcon={CalendarDays}
              onPress={() => setShowDatePicker(true)}
              variant="secondary"
            />
            <Button
              disabled={!selected || pendingAction !== null}
              fullWidth
              label="Guardar tiempo manual"
              loading={pendingAction === 'manual-duration'}
              onPress={() =>
                selected &&
                void run('manual-duration', () =>
                  recordManualDuration(selected.id, minutes * 60, manualDate),
                )
              }
              variant="secondary"
            />
          </View>
        )}
      </FeedbackSheet>
      <AtlasCalendarSheet
        maxDate={dateKey(new Date())}
        onClose={() => setShowDatePicker(false)}
        onConfirm={(value) => {
          if (value) setManualDateOverride(value);
          setShowDatePicker(false);
        }}
        title="Fecha del tiempo manual"
        value={manualDate}
        visible={timerSheetOpen && showDatePicker}
      />
    </>
  );
}

type AtlasTabBarProps = Parameters<
  NonNullable<ComponentProps<typeof Tabs>['tabBar']>
>[0];

function AtlasTabBar({ state, descriptors, navigation }: AtlasTabBarProps) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const keyboardVisible = useKeyboardVisible();
  const activeRouteKey = state.routes[state.index]?.key;
  const routes = state.routes.filter((route) => route.name !== 'create-fab');

  if (keyboardVisible) return null;

  return (
    <View
      style={[
        styles.customTabBar,
        {
          height: 96 + insets.bottom + tabBarExtraHeight(fontScale),
          paddingBottom: Math.max(insets.bottom, 8),
        },
      ]}
    >
      <View
        pointerEvents="none"
        style={[
          styles.tabBarSurface,
          {
            backgroundColor: theme.colors.surface,
            borderTopColor: theme.colors.border,
          },
        ]}
      />
      <View accessibilityRole="tablist" style={styles.tabBarItems}>
        {routes.map((route, routeIndex) => {
          const options = descriptors[route.key].options;
          const focused = activeRouteKey === route.key;
          const label =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : typeof options.title === 'string'
                ? options.title
                : route.name;
          const color = focused ? theme.colors.primary : theme.colors.textMuted;
          const onPress = () => {
            const event = navigation.emit({
              canPreventDefault: true,
              target: route.key,
              type: 'tabPress',
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <Pressable
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              key={route.key}
              onLongPress={() =>
                navigation.emit({ target: route.key, type: 'tabLongPress' })
              }
              onPress={onPress}
              style={({ pressed }) => [
                styles.customTabItem,
                routeIndex === 1 && styles.customTabItemBeforeFab,
                routeIndex === 2 && styles.customTabItemAfterFab,
                pressed && styles.customTabItemPressed,
              ]}
            >
              {options.tabBarIcon?.({ color, focused, size: 25 })}
              <Text
                align="center"
                maxFontSizeMultiplier={2}
                numberOfLines={2}
                style={{ color }}
                variant={focused ? 'label' : 'caption'}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        accessibilityHint="Abre el formulario para añadir un elemento"
        accessibilityLabel="Crear hábito, tarea o rutina"
        accessibilityRole="button"
        hitSlop={4}
        onPress={() => router.push('/create')}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      >
        <View
          pointerEvents="none"
          style={[
            styles.fabSurface,
            {
              backgroundColor: theme.colors.primary,
              borderColor: theme.colors.surface,
            },
            theme.shadows.floating,
          ]}
        >
          <Plus color={theme.colors.textInverse} size={29} strokeWidth={2.8} />
        </View>
      </Pressable>
    </View>
  );
}

export default function TabsLayout() {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <Tabs
        backBehavior="history"
        tabBar={(props) => <AtlasTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          lazy: true,
          sceneStyle: { backgroundColor: theme.colors.background },
          tabBarActiveTintColor: theme.colors.primary,
          tabBarInactiveTintColor: theme.colors.textMuted,
          tabBarHideOnKeyboard: true,
          tabBarItemStyle: styles.tabItem,
          tabBarLabelStyle: {
            fontFamily: theme.typography.fontFamilies.medium,
            fontSize: 11,
            lineHeight: 15,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Hoy',
            tabBarIcon: ({ color, focused, size }) => (
              <CalendarDays
                color={color}
                fill={focused ? color : 'transparent'}
                size={size}
                strokeWidth={focused ? 2.4 : 2}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="plan"
          options={{
            title: 'Plan',
            tabBarIcon: ({ color, focused, size }) => (
              <ListTodo
                color={color}
                size={size}
                strokeWidth={focused ? 2.4 : 2}
              />
            ),
          }}
        />
        <Tabs.Screen name="create-fab" options={{ href: null }} />
        <Tabs.Screen
          name="stats"
          options={{
            tabBarAccessibilityLabel: 'Progreso',
            tabBarLabel: 'Avance',
            title: 'Progreso',
            tabBarIcon: ({ color, focused, size }) => (
              <BarChart3
                color={color}
                size={size}
                strokeWidth={focused ? 2.4 : 2}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Ajustes',
            tabBarIcon: ({ color, focused, size }) => (
              <Settings
                color={color}
                size={size}
                strokeWidth={focused ? 2.4 : 2}
              />
            ),
          }}
        />
      </Tabs>
      <GlobalTimerSurface />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabItem: { minHeight: 52 },
  customTabBar: {
    overflow: 'visible',
    paddingTop: 28,
    position: 'relative',
  },
  tabBarItems: { flex: 1, flexDirection: 'row' },
  tabBarSurface: {
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 18,
  },
  customTabItem: {
    alignItems: 'center',
    flex: 1,
    gap: 2,
    justifyContent: 'flex-start',
    minHeight: 52,
  },
  customTabItemBeforeFab: { marginRight: 38 },
  customTabItemAfterFab: { marginLeft: 38 },
  customTabItemPressed: { opacity: 0.7 },
  fab: {
    alignItems: 'center',
    borderRadius: 32,
    height: 64,
    justifyContent: 'center',
    left: '50%',
    marginLeft: -32,
    position: 'absolute',
    top: 0,
    width: 64,
    zIndex: 20,
  },
  fabPressed: { transform: [{ scale: 0.94 }] },
  fabSurface: {
    alignItems: 'center',
    borderRadius: 32,
    borderWidth: 4,
    flex: 1,
    justifyContent: 'center',
    width: '100%',
  },
  miniTimer: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    left: 16,
    minHeight: 58,
    paddingHorizontal: 14,
    position: 'absolute',
    right: 16,
  },
  miniTimerPressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  miniTimerCopy: { flex: 1, gap: 1 },
  timerDigits: { fontVariant: ['tabular-nums'] },
  sheetTimerDigits: { fontVariant: ['tabular-nums'], paddingVertical: 8 },
  timerSection: { gap: 12 },
  timerActions: { gap: 8 },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  manualHeader: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  stepper: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
});
