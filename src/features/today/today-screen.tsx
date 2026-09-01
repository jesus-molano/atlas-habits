import { useRouter } from 'expo-router';
import { CalendarDays, Map, Plus, Timer } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  Screen,
  SectionHeader,
  Text,
} from '@/components/core';
import {
  AtlasCalendarSheet,
  FeedbackSheet,
} from '@/components/core/feedback-overlay';
import { useTheme } from '@/design';
import { isScheduledOnDate, useAtlasApp } from '@/features/atlas';
import { PageHeader } from '@/features/ui';

import { HabitCard, RoutineCard, TaskCard } from './item-cards';
import { todayDateStripKeys } from './today-date-strip';

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase('es') + value.slice(1);
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function TodayDateStrip({
  selectedDate,
  onSelect,
}: {
  selectedDate: string;
  onSelect: (date: string) => void;
}) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const dateCellHeight = Math.round(
    64 + Math.max(0, Math.min(fontScale, 2) - 1) * 32,
  );
  const days = todayDateStripKeys(selectedDate).map(
    (date) => new Date(`${date}T12:00:00`),
  );
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.dateStrip, { height: dateCellHeight }]}
    >
      {days.map((date) => {
        const key = localDateKey(date);
        const selected = key === selectedDate;
        return (
          <Pressable
            accessibilityLabel={date.toLocaleDateString('es-ES', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={key}
            onPress={() => onSelect(key)}
            style={[
              styles.dateCell,
              { height: dateCellHeight },
              {
                backgroundColor: selected
                  ? theme.colors.primary
                  : theme.colors.surface,
                borderColor: selected
                  ? theme.colors.primary
                  : theme.colors.border,
              },
            ]}
          >
            <Text
              color={selected ? 'textInverse' : 'textMuted'}
              variant="eyebrow"
            >
              {date
                .toLocaleDateString('es-ES', { weekday: 'short' })
                .slice(0, 2)}
            </Text>
            <Text
              color={selected ? 'textInverse' : 'text'}
              variant="bodyStrong"
            >
              {date.getDate()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function InlineEmpty({
  title,
  actionLabel,
  onPress,
}: {
  title: string;
  actionLabel: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={`${title}. ${actionLabel}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.inlineEmpty,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text style={styles.inlineEmptyCopy} tone="secondary" variant="caption">
        {title}
      </Text>
      <Plus color={theme.colors.primary} size={18} strokeWidth={2.3} />
      <Text color="primary" variant="label">
        {actionLabel}
      </Text>
    </Pressable>
  );
}

export function TodayScreen() {
  const router = useRouter();
  const theme = useTheme();
  const {
    snapshot,
    hydrated,
    selectedDate,
    selectedHabits,
    isToday,
    progress,
    toggleHabit,
    addHabitValue,
    toggleTask,
    toggleSubtask,
    skipHabit,
    pauseHabit,
    resumeHabit,
    setSelectedDate,
    openTimerSheet,
  } = useAtlasApp();
  const [datePickerMode, setDatePickerMode] = useState<
    'history' | 'pause' | null
  >(null);
  const [pauseTargetId, setPauseTargetId] = useState<string | null>(null);
  const [actionHabitId, setActionHabitId] = useState<string | null>(null);
  const hasProfileContent =
    snapshot.habits.length > 0 ||
    snapshot.tasks.length > 0 ||
    snapshot.routines.length > 0;
  const selectedTasks = snapshot.tasks.filter((item) =>
    isScheduledOnDate(item.schedule, selectedDate),
  );
  const selectedRoutines = snapshot.routines.filter((item) =>
    isScheduledOnDate(item.schedule, selectedDate),
  );
  const selectedDateObject = new Date(`${selectedDate}T12:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pauseMinimumDate = new Date(today);
  pauseMinimumDate.setDate(pauseMinimumDate.getDate() + 1);
  const todayKey = localDateKey(today);
  const pauseMinimumDateKey = localDateKey(pauseMinimumDate);
  const dateLabel = capitalize(
    selectedDateObject.toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
  );
  const actionHabit = selectedHabits.find(
    (habit) => habit.id === actionHabitId,
  );

  const closeDatePicker = () => {
    if (datePickerMode === 'pause') setPauseTargetId(null);
    setDatePickerMode(null);
  };

  const confirmDatePicker = (value: string | null) => {
    const mode = datePickerMode;
    if (!value || !mode) return;
    setDatePickerMode(null);
    if (mode === 'history') {
      setSelectedDate(value);
      return;
    }
    if (pauseTargetId) {
      pauseHabit(pauseTargetId, value);
      setPauseTargetId(null);
    }
  };

  if (!hydrated) {
    return (
      <Screen
        contentContainerStyle={styles.content}
        safeAreaEdges={['top', 'left', 'right']}
        scroll
      >
        <PageHeader
          description={dateLabel}
          eyebrow="Atlas diario"
          title="Hoy"
        />
        <View
          accessibilityLabel="Cargando tu día"
          accessibilityLiveRegion="polite"
          accessibilityRole="progressbar"
          style={styles.loading}
        >
          <ActivityIndicator color={theme.colors.primary} size="large" />
          <Text tone="secondary">Preparando tu día…</Text>
        </View>
      </Screen>
    );
  }

  if (!hasProfileContent) {
    return (
      <Screen
        contentContainerStyle={styles.content}
        safeAreaEdges={['top', 'left', 'right']}
        scroll
      >
        <PageHeader
          description={dateLabel}
          eyebrow="Atlas diario"
          title="Hoy"
        />
        <EmptyState
          actionLabel="Crear mi primer elemento"
          description="Añade primero el hábito que quieres ver cada día. Todo se guarda en este dispositivo."
          icon={Map}
          onAction={() => router.push('/create?type=habit')}
          title="Tu Atlas empieza aquí"
        />
      </Screen>
    );
  }

  return (
    <Screen
      contentContainerStyle={styles.content}
      safeAreaEdges={['top', 'left', 'right']}
      scroll
      scrollProps={{
        contentInsetAdjustmentBehavior: 'never',
        keyboardDismissMode: 'on-drag',
      }}
    >
      <PageHeader
        actionIcon={Timer}
        actionLabel="Abrir cronómetro"
        description={dateLabel}
        eyebrow="Atlas diario"
        onAction={() => openTimerSheet()}
        title="Hoy"
      />

      <TodayDateStrip onSelect={setSelectedDate} selectedDate={selectedDate} />
      <Button
        fullWidth
        label="Elegir otra fecha"
        leadingIcon={CalendarDays}
        onPress={() => setDatePickerMode('history')}
        size="sm"
        variant="ghost"
      />

      <AtlasCalendarSheet
        initialMonth={
          datePickerMode === 'pause' ? pauseMinimumDateKey : selectedDate
        }
        maxDate={datePickerMode === 'history' ? todayKey : undefined}
        minDate={datePickerMode === 'pause' ? pauseMinimumDateKey : undefined}
        onClose={closeDatePicker}
        onConfirm={confirmDatePicker}
        title={
          datePickerMode === 'pause' ? 'Pausar hasta una fecha' : 'Elegir fecha'
        }
        value={datePickerMode === 'pause' ? pauseMinimumDateKey : selectedDate}
        visible={datePickerMode !== null}
      />

      <Card padding="sm" style={styles.progressCard} variant="outlined">
        <View style={styles.progressCopy}>
          <Text variant="label">
            {progress.completed} de {progress.total} completados
          </Text>
          <Text tone="secondary" variant="caption">
            {progress.total === 0
              ? 'Nada programado para esta fecha.'
              : progress.ratio >= 1
                ? 'Día completado.'
                : 'Empieza por un hábito.'}
          </Text>
        </View>
        <Text tone="accent" variant="bodyStrong">
          {Math.round(progress.ratio * 100)}%
        </Text>
        <View
          accessibilityLabel={`${Math.round(progress.ratio * 100)} por ciento del día completado`}
          accessibilityRole="progressbar"
          accessibilityValue={{
            min: 0,
            max: 100,
            now: Math.round(progress.ratio * 100),
          }}
          style={[
            styles.progressTrack,
            { backgroundColor: theme.colors.track },
          ]}
        >
          <View
            style={[
              styles.progressFill,
              {
                backgroundColor: theme.colors.primary,
                width: `${Math.round(progress.ratio * 100)}%`,
              },
            ]}
          />
        </View>
      </Card>

      {!isToday ? (
        <Card padding="sm" variant="tinted">
          <Text align="center" tone="secondary" variant="caption">
            Estás revisando los hábitos de esta fecha. Puedes corregirlos y
            añadir tiempo manual; el foco histórico se consulta en Avance.
          </Text>
        </Card>
      ) : null}

      <View style={styles.section}>
        <SectionHeader title="Hábitos" />
        <View style={styles.list}>
          {selectedHabits.length === 0 ? (
            <InlineEmpty
              actionLabel="Crear hábito"
              onPress={() => router.push('/create?type=habit')}
              title="No hay hábitos programados."
            />
          ) : (
            selectedHabits.map((habit) => (
              <HabitCard
                habit={habit}
                key={habit.id}
                onAdd={(amount) => addHabitValue(habit.id, amount)}
                onOpenActions={() => setActionHabitId(habit.id)}
                onOpenTimer={
                  habit.metric === 'duration'
                    ? () => openTimerSheet(habit.id)
                    : undefined
                }
                durationActionMode={isToday ? 'timer' : 'manual'}
                onToggle={() => toggleHabit(habit.id)}
              />
            ))
          )}
        </View>
      </View>

      {isToday ? (
        <>
          <View style={styles.section}>
            <SectionHeader title="Tareas" />
            <View style={styles.list}>
              {selectedTasks.length === 0 ? (
                <InlineEmpty
                  actionLabel="Crear tarea"
                  onPress={() => router.push('/create?type=task')}
                  title="No hay tareas para hoy."
                />
              ) : (
                selectedTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    onOpenTimer={() => openTimerSheet(task.id)}
                    onToggle={() => toggleTask(task.id)}
                    onToggleSubtask={(subtaskId) =>
                      toggleSubtask(task.id, subtaskId)
                    }
                    task={task}
                  />
                ))
              )}
            </View>
          </View>

          <View style={styles.section}>
            <SectionHeader title="Rutinas" />
            <View style={styles.list}>
              {selectedRoutines.length === 0 ? (
                <InlineEmpty
                  actionLabel="Crear rutina"
                  onPress={() => router.push('/create?type=routine')}
                  title="No hay rutinas para hoy."
                />
              ) : (
                selectedRoutines.map((routine) => (
                  <RoutineCard
                    key={routine.id}
                    onPress={() => router.push(`/routine/${routine.id}`)}
                    routine={routine}
                  />
                ))
              )}
            </View>
          </View>
        </>
      ) : null}

      <FeedbackSheet
        actions={
          actionHabit
            ? [
                {
                  label: actionHabit.skipped
                    ? 'Deshacer omisión'
                    : 'Omitir este día',
                  onPress: () => {
                    skipHabit(actionHabit.id);
                    setActionHabitId(null);
                  },
                },
                {
                  label: 'Editar hábito',
                  onPress: () => {
                    setActionHabitId(null);
                    router.push(`/create?id=${actionHabit.id}`);
                  },
                },
                actionHabit.paused
                  ? {
                      label: 'Reanudar hábito',
                      onPress: () => {
                        resumeHabit(actionHabit.id);
                        setActionHabitId(null);
                      },
                    }
                  : {
                      label: 'Pausar hasta una fecha',
                      onPress: () => {
                        setPauseTargetId(actionHabit.id);
                        setActionHabitId(null);
                        setDatePickerMode('pause');
                      },
                    },
              ]
            : []
        }
        message="Ajusta este hábito sin perder el contexto del día."
        onClose={() => setActionHabitId(null)}
        title={actionHabit?.title ?? 'Acciones del hábito'}
        visible={Boolean(actionHabit)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 148, paddingTop: 8 },
  dateStrip: { flexDirection: 'row', gap: 6 },
  dateCell: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    gap: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  loading: {
    alignItems: 'center',
    flex: 1,
    gap: 14,
    justifyContent: 'center',
    minHeight: 320,
  },
  progressCard: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  progressCopy: { flex: 1, gap: 1 },
  progressTrack: {
    borderRadius: 999,
    height: 5,
    overflow: 'hidden',
    width: '100%',
  },
  progressFill: { borderRadius: 999, height: '100%' },
  section: { gap: 7 },
  list: { gap: 9 },
  inlineEmpty: {
    alignItems: 'center',
    borderRadius: 14,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    minHeight: 60,
    paddingHorizontal: 14,
  },
  inlineEmptyCopy: { flex: 1 },
});
