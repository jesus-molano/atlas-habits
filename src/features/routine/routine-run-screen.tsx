import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Pause,
  Play,
  RotateCcw,
  X,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Button,
  EmptyState,
  IconButton,
  ProgressOrbit,
  Text,
} from '@/components/core';
import { FeedbackSheet } from '@/components/core/feedback-overlay';
import { useTheme } from '@/design';
import { useAtlasApp } from '@/features/atlas';

function formatClock(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const remainder = Math.max(0, seconds) % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
}

export function RoutineRunScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const {
    snapshot,
    startRoutine,
    setRoutineStep,
    finishRoutine,
    resetRoutine,
  } = useAtlasApp();
  const routine = snapshot.routines.find((item) => item.id === id);
  const initialIndex = useMemo(() => {
    if (!routine) return 0;
    const firstIncomplete = routine.steps.findIndex((step) => !step.completed);
    return firstIncomplete < 0
      ? Math.max(0, routine.steps.length - 1)
      : firstIncomplete;
  }, [routine]);
  const [index, setIndex] = useState(initialIndex);
  const step = routine?.steps[index];
  const [remaining, setRemaining] = useState(step?.durationSeconds ?? 0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);

  useEffect(() => {
    if (routine) startRoutine(routine.id);
    // This intentionally runs once for the opened routine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routine?.id]);

  useEffect(() => {
    if (!timerRunning || remaining <= 0) return;
    const interval = setInterval(() => {
      setRemaining((value) => Math.max(0, value - 1));
    }, 1_000);
    return () => clearInterval(interval);
  }, [remaining, timerRunning]);

  if (!routine || !step) {
    return (
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
      >
        <EmptyState
          actionLabel="Volver a Hoy"
          description="Puede que esta rutina se haya eliminado o todavía no se haya sincronizado."
          onAction={() => router.replace('/(tabs)')}
          title="No encontramos esta ruta"
        />
      </SafeAreaView>
    );
  }

  const completed = routine.steps.filter((item) => item.completed).length;
  const isLast = index === routine.steps.length - 1;
  const timerFinished = !step.durationSeconds || remaining === 0;
  const timerActive = timerRunning && remaining > 0;

  const navigateToStep = (nextIndex: number) => {
    const bounded = Math.max(0, Math.min(routine.steps.length - 1, nextIndex));
    setIndex(bounded);
    setRemaining(routine.steps[bounded]?.durationSeconds ?? 0);
    setTimerRunning(false);
  };

  const next = (complete: boolean) => {
    if (complete) setRoutineStep(routine.id, step.id, true);
    if (isLast) {
      finishRoutine(routine.id);
      router.replace('/(tabs)');
      return;
    }
    navigateToStep(index + 1);
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.orbits} pointerEvents="none">
        <View style={[styles.orbitOne, { borderColor: theme.colors.border }]} />
        <View
          style={[styles.orbitTwo, { borderColor: theme.colors.primaryMuted }]}
        />
        <View
          style={[
            styles.orbitWaypoint,
            { backgroundColor: theme.colors.primary },
          ]}
        />
      </View>

      <View style={styles.header}>
        <IconButton
          accessibilityLabel="Salir de la rutina"
          icon={X}
          onPress={() => router.back()}
          variant="tonal"
        />
        <View style={styles.headerCopy}>
          <Text align="center" numberOfLines={1} variant="label">
            {routine.title}
          </Text>
          <Text align="center" tone="muted" variant="caption">
            Paso {index + 1} de {routine.steps.length}
          </Text>
        </View>
        <IconButton
          accessibilityLabel="Reiniciar rutina"
          icon={RotateCcw}
          onPress={() => setResetConfirmationOpen(true)}
          variant="ghost"
        />
      </View>

      <View
        accessibilityLabel={`Progreso: ${completed} de ${routine.steps.length} pasos`}
        accessibilityRole="progressbar"
        accessibilityValue={{
          min: 0,
          max: routine.steps.length,
          now: completed,
        }}
        style={[styles.routeTrack, { backgroundColor: theme.colors.track }]}
      >
        <View
          style={[
            styles.routeFill,
            {
              backgroundColor: theme.colors.primary,
              width: `${((index + 1) / routine.steps.length) * 100}%`,
            },
          ]}
        />
      </View>

      <View style={styles.stage}>
        <View style={styles.stepMeta}>
          <Text tone="accent" variant="eyebrow">
            {step.required ? 'PASO OBLIGATORIO' : 'PASO OPCIONAL'}
          </Text>
          {step.completed ? (
            <View
              style={[
                styles.doneBadge,
                { backgroundColor: theme.colors.primaryMuted },
              ]}
            >
              <Check color={theme.colors.primary} size={16} />
              <Text color="primary" variant="caption">
                Hecho
              </Text>
            </View>
          ) : null}
        </View>

        <Text align="center" style={styles.stepTitle} variant="display">
          {step.title}
        </Text>

        {step.durationSeconds ? (
          <View style={styles.timerArea}>
            <ProgressOrbit
              accessibilityLabel={`${formatClock(remaining)} restantes`}
              max={step.durationSeconds}
              showValue={false}
              size={178}
              strokeWidth={9}
              value={step.durationSeconds - remaining}
            />
            <View pointerEvents="none" style={styles.timerCopy}>
              <Clock3 color={theme.colors.primary} size={22} />
              <Text variant="display">{formatClock(remaining)}</Text>
              <Text tone="muted" variant="caption">
                {timerFinished
                  ? 'Tiempo completado'
                  : timerActive
                    ? 'En marcha'
                    : 'Listo'}
              </Text>
            </View>
            {!timerFinished ? (
              <IconButton
                accessibilityLabel={
                  timerActive ? 'Pausar temporizador' : 'Iniciar temporizador'
                }
                icon={timerActive ? Pause : Play}
                onPress={() => setTimerRunning((value) => !value)}
                selected={timerActive}
                size="large"
                style={styles.timerAction}
                variant="solid"
              />
            ) : null}
          </View>
        ) : (
          <View
            style={[
              styles.freeStep,
              { backgroundColor: theme.colors.surfaceMuted },
            ]}
          >
            <CheckCircleGraphic />
            <Text align="center" tone="secondary" variant="body">
              Sin temporizador. Avanza cuando hayas terminado.
            </Text>
          </View>
        )}
      </View>

      <View style={[styles.footer, { borderTopColor: theme.colors.border }]}>
        <View style={styles.navigationRow}>
          <Button
            disabled={index === 0}
            label="Anterior"
            leadingIcon={ChevronLeft}
            onPress={() => navigateToStep(index - 1)}
            variant="ghost"
          />
          <Text tone="muted" variant="caption">
            {index + 1} / {routine.steps.length}
          </Text>
          {!step.required ? (
            <Button
              label="Omitir"
              onPress={() => next(false)}
              trailingIcon={ChevronRight}
              variant="ghost"
            />
          ) : (
            <View style={styles.footerSpacer} />
          )}
        </View>
        <Button
          disabled={!timerFinished}
          fullWidth
          label={
            isLast
              ? 'Terminar rutina'
              : step.completed
                ? 'Siguiente paso'
                : 'Completar y seguir'
          }
          leadingIcon={Check}
          onPress={() => next(true)}
          size="lg"
        />
      </View>
      <FeedbackSheet
        actions={[
          {
            label: 'Reiniciar rutina',
            variant: 'danger',
            onPress: () => {
              resetRoutine(routine.id);
              navigateToStep(0);
              setResetConfirmationOpen(false);
            },
          },
        ]}
        message="Se desmarcarán todos los pasos de esta ejecución."
        onClose={() => setResetConfirmationOpen(false)}
        title="Reiniciar rutina"
        tone="danger"
        visible={resetConfirmationOpen}
      />
    </SafeAreaView>
  );
}

function CheckCircleGraphic() {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.freeIcon,
        {
          backgroundColor: theme.colors.primaryMuted,
          borderColor: theme.colors.primary,
        },
      ]}
    >
      <Check color={theme.colors.primary} size={30} strokeWidth={2.4} />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, overflow: 'hidden' },
  orbits: {
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
    top: 0,
  },
  orbitOne: {
    borderRadius: 280,
    borderStyle: 'dashed',
    borderWidth: 1,
    height: 560,
    opacity: 0.35,
    position: 'absolute',
    right: -350,
    top: 120,
    transform: [{ rotate: '18deg' }],
    width: 560,
  },
  orbitTwo: {
    borderRadius: 190,
    borderWidth: 1,
    height: 380,
    left: -285,
    opacity: 0.4,
    position: 'absolute',
    top: 310,
    transform: [{ rotate: '-20deg' }],
    width: 380,
  },
  orbitWaypoint: {
    borderRadius: 6,
    height: 12,
    position: 'absolute',
    right: 31,
    top: 217,
    width: 12,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  headerCopy: { flex: 1, gap: 1 },
  routeTrack: {
    borderRadius: 999,
    height: 4,
    marginHorizontal: 20,
    marginTop: 12,
    overflow: 'hidden',
  },
  routeFill: { borderRadius: 999, height: '100%' },
  stage: {
    alignItems: 'center',
    flex: 1,
    gap: 26,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  stepMeta: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  doneBadge: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  stepTitle: { maxWidth: 560 },
  timerArea: {
    alignItems: 'center',
    height: 250,
    justifyContent: 'center',
    width: 230,
  },
  timerCopy: { alignItems: 'center', gap: 4, position: 'absolute' },
  timerAction: { bottom: -2, position: 'absolute' },
  freeStep: {
    alignItems: 'center',
    borderRadius: 28,
    gap: 16,
    maxWidth: 340,
    paddingHorizontal: 32,
    paddingVertical: 28,
  },
  freeIcon: {
    alignItems: 'center',
    borderRadius: 32,
    borderWidth: 1,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  navigationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  footerSpacer: { minWidth: 92 },
});
