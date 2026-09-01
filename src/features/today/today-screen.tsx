import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Map,
  Settings2,
} from 'lucide-react-native';
import { useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  IconButton,
  ProgressOrbit,
  Screen,
  SectionHeader,
  Text,
} from '@/components/core';
import { useTheme } from '@/design';
import {
  isScheduledOnDate,
  useAtlasApp,
  type DashboardSectionId,
} from '@/features/atlas';
import { PageHeader } from '@/features/ui';

import { HabitCard, RoutineCard, TaskCard } from './item-cards';

const sectionNames: Record<DashboardSectionId, string> = {
  routines: 'Rutinas',
  habits: 'Hábitos',
  tasks: 'Tareas',
};

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
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const date = new Date();
        date.setDate(date.getDate() + index - 6);
        return date;
      }),
    [],
  );
  return (
    <View accessibilityRole="tablist" style={styles.dateStrip}>
      {days.map((date) => {
        const dateKey = localDateKey(date);
        const selected = dateKey === selectedDate;
        return (
          <Pressable
            accessibilityLabel={date.toLocaleDateString('es-ES', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={date.toISOString()}
            onPress={() => onSelect(dateKey)}
            style={[
              styles.dateCell,
              selected && {
                backgroundColor: theme.colors.primary,
                borderColor: theme.colors.primary,
              },
              !selected && { borderColor: 'transparent' },
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

type OrderedSectionProps = {
  section: DashboardSectionId;
  index: number;
  total: number;
  ordering: boolean;
  onMove: (direction: -1 | 1) => void;
  children: ReactNode;
};

function OrderedSection({
  section,
  index,
  total,
  ordering,
  onMove,
  children,
}: OrderedSectionProps) {
  return (
    <View style={styles.section}>
      <SectionHeader
        action={
          ordering ? (
            <View style={styles.orderActions}>
              <IconButton
                accessibilityLabel={`Subir ${sectionNames[section]}`}
                disabled={index === 0}
                icon={ArrowUp}
                onPress={() => onMove(-1)}
                size="compact"
                variant="tonal"
              />
              <IconButton
                accessibilityLabel={`Bajar ${sectionNames[section]}`}
                disabled={index === total - 1}
                icon={ArrowDown}
                onPress={() => onMove(1)}
                size="compact"
                variant="tonal"
              />
            </View>
          ) : undefined
        }
        title={sectionNames[section]}
      />
      <View style={styles.list}>{children}</View>
    </View>
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
    startHabitTimer,
    stopHabitTimer,
    toggleTask,
    toggleSubtask,
    skipHabit,
    pauseHabit,
    resumeHabit,
    setSelectedDate,
    moveDashboardSection,
  } = useAtlasApp();
  const [ordering, setOrdering] = useState(false);
  const [datePickerMode, setDatePickerMode] = useState<
    'history' | 'pause' | null
  >(null);
  const [pauseTargetId, setPauseTargetId] = useState<string | null>(null);
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
  const dateLabel = capitalize(
    selectedDateObject.toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
  );

  const openHabitActions = (habitId: string) => {
    const habit = selectedHabits.find((item) => item.id === habitId);
    if (!habit) return;
    Alert.alert(habit.title, 'Elige cómo ajustar este punto de la ruta.', [
      {
        text: habit.skipped ? 'Deshacer omisión' : 'Omitir este día',
        onPress: () => skipHabit(habit.id),
      },
      {
        text: 'Editar hábito',
        onPress: () => router.push(`/create?id=${habit.id}`),
      },
      habit.paused
        ? { text: 'Reanudar hábito', onPress: () => resumeHabit(habit.id) }
        : {
            text: 'Pausar hasta…',
            onPress: () => {
              setPauseTargetId(habit.id);
              setDatePickerMode('pause');
            },
          },
    ]);
  };

  const onDatePickerChange = (event: DateTimePickerEvent, value?: Date) => {
    const mode = datePickerMode;
    if (Platform.OS === 'android' || event.type === 'dismissed') {
      setDatePickerMode(null);
    }
    if (event.type === 'dismissed' && mode === 'pause') {
      setPauseTargetId(null);
    }
    if (event.type !== 'set' || !value || !mode) return;
    if (mode === 'history') {
      setSelectedDate(localDateKey(value));
      return;
    }
    if (pauseTargetId) {
      pauseHabit(pauseTargetId, localDateKey(value));
      setPauseTargetId(null);
    }
  };

  if (!hydrated) {
    return (
      <Screen
        contentContainerStyle={styles.content}
        safeAreaEdges={['top', 'left', 'right']}
        scroll
        scrollProps={{ contentInsetAdjustmentBehavior: 'never' }}
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
          <Text align="center" tone="secondary" variant="body">
            Preparando tu día…
          </Text>
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
        scrollProps={{ contentInsetAdjustmentBehavior: 'never' }}
      >
        <PageHeader
          description={dateLabel}
          eyebrow="Atlas diario"
          title="Hoy"
        />
        <EmptyState
          actionLabel="Crear mi primer elemento"
          description="Añade un hábito, una tarea o una rutina. Todo se guardará en este dispositivo."
          icon={Map}
          onAction={() => router.push('/create')}
          title="Tu Atlas empieza aquí"
        />
        <View style={styles.bottomSpace} />
      </Screen>
    );
  }

  const section = (id: DashboardSectionId): ReactNode => {
    if (id === 'habits') {
      if (selectedHabits.length === 0) {
        return (
          <EmptyState
            actionLabel="Crear hábito"
            compact
            description="Traza el primer punto de tu día."
            onAction={() => router.push('/create?type=habit')}
            title="Sin hábitos para hoy"
          />
        );
      }
      return selectedHabits.map((habit) => (
        <HabitCard
          habit={habit}
          key={habit.id}
          onAdd={(amount) => addHabitValue(habit.id, amount)}
          onStartTimer={() => startHabitTimer(habit.id)}
          onStopTimer={() => stopHabitTimer(habit.id)}
          onToggle={() => toggleHabit(habit.id)}
          onOpenActions={() => openHabitActions(habit.id)}
          timerAvailable={isToday}
        />
      ));
    }

    if (id === 'tasks') {
      if (selectedTasks.length === 0) {
        return (
          <EmptyState
            actionLabel="Crear tarea"
            compact
            description="No hay tareas pendientes en la ruta."
            onAction={() => router.push('/create?type=task')}
            title="Día despejado"
          />
        );
      }
      return selectedTasks.map((task) => (
        <TaskCard
          key={task.id}
          onToggle={() => toggleTask(task.id)}
          onToggleSubtask={(subtaskId) => toggleSubtask(task.id, subtaskId)}
          task={task}
        />
      ));
    }

    if (selectedRoutines.length === 0) {
      return (
        <EmptyState
          actionLabel="Crear rutina"
          compact
          description="Agrupa pasos para recorrerlos sin distracciones."
          onAction={() => router.push('/create?type=routine')}
          title="Sin rutas guiadas"
        />
      );
    }
    return selectedRoutines.map((routine) => (
      <RoutineCard
        key={routine.id}
        onPress={() => router.push(`/routine/${routine.id}`)}
        routine={routine}
      />
    ));
  };

  return (
    <Screen
      contentContainerStyle={styles.content}
      safeAreaEdges={['top', 'left', 'right']}
      scroll
      scrollProps={{ contentInsetAdjustmentBehavior: 'never' }}
    >
      <PageHeader
        actionIcon={Settings2}
        actionLabel={ordering ? 'Terminar de ordenar' : 'Ordenar panel'}
        description={dateLabel}
        eyebrow="Atlas diario"
        onAction={() => setOrdering((value) => !value)}
        title="Hoy"
      />

      <TodayDateStrip onSelect={setSelectedDate} selectedDate={selectedDate} />

      <Button
        fullWidth
        label="Elegir otra fecha"
        leadingIcon={CalendarDays}
        onPress={() => setDatePickerMode('history')}
        size="sm"
        variant="secondary"
      />

      {datePickerMode ? (
        <DateTimePicker
          display="calendar"
          maximumDate={datePickerMode === 'history' ? today : undefined}
          minimumDate={
            datePickerMode === 'pause' ? pauseMinimumDate : undefined
          }
          mode="date"
          onChange={onDatePickerChange}
          value={
            datePickerMode === 'pause' ? pauseMinimumDate : selectedDateObject
          }
        />
      ) : null}

      {!isToday ? (
        <Card padding="sm" variant="tinted">
          <Text align="center" tone="secondary" variant="caption">
            Editas el historial del {dateLabel.toLocaleLowerCase('es')}. Puedes
            corregir valores u omitir el día sin romper la racha.
          </Text>
        </Card>
      ) : null}

      <Card padding="lg" style={styles.hero} variant="raised">
        <View style={styles.heroRoute} pointerEvents="none">
          <View
            style={[
              styles.orbitLine,
              { borderColor: theme.colors.borderStrong },
            ]}
          />
          <View
            style={[styles.waypoint, { backgroundColor: theme.colors.primary }]}
          />
        </View>
        <View style={styles.heroCopy}>
          <View style={styles.heroEyebrow}>
            <Map color={theme.colors.primary} size={16} strokeWidth={2.2} />
            <Text tone="accent" variant="eyebrow">
              RUMBO DE HOY
            </Text>
          </View>
          <Text variant="heading">
            {progress.completed} de {progress.total} puntos alcanzados
          </Text>
          <Text tone="secondary" variant="caption">
            {progress.ratio >= 1
              ? 'Ruta completa. El resto del día es tuyo.'
              : progress.ratio >= 0.5
                ? 'Ya has cruzado la mitad del recorrido.'
                : 'Avanza con una acción pequeña cada vez.'}
          </Text>
        </View>
        <ProgressOrbit
          accessibilityLabel={`${progress.completed} de ${progress.total} elementos completados`}
          max={Math.max(1, progress.total)}
          size={82}
          value={progress.completed}
        />
      </Card>

      {ordering ? (
        <Card padding="sm" variant="outlined">
          <Text align="center" tone="secondary" variant="caption">
            Usa las flechas para colocar primero lo que más te importa.
          </Text>
        </Card>
      ) : null}

      {snapshot.dashboardOrder
        .filter((sectionId) => isToday || sectionId === 'habits')
        .map((sectionId, index, visibleSections) => (
          <OrderedSection
            index={index}
            key={sectionId}
            onMove={(direction) => moveDashboardSection(sectionId, direction)}
            ordering={ordering}
            section={sectionId}
            total={visibleSections.length}
          >
            {section(sectionId)}
          </OrderedSection>
        ))}
      <View style={styles.bottomSpace} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 20, paddingBottom: 112, paddingTop: 12 },
  dateStrip: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  dateCell: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    gap: 2,
    minHeight: 62,
    justifyContent: 'center',
  },
  loading: {
    alignItems: 'center',
    flex: 1,
    gap: 14,
    justifyContent: 'center',
    minHeight: 320,
  },
  hero: { alignItems: 'center', flexDirection: 'row', gap: 16, minHeight: 142 },
  heroCopy: { flex: 1, gap: 6 },
  heroEyebrow: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  heroRoute: {
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
    top: 0,
  },
  orbitLine: {
    borderRadius: 130,
    borderStyle: 'dashed',
    borderWidth: 1,
    height: 210,
    opacity: 0.32,
    position: 'absolute',
    right: -90,
    top: -100,
    transform: [{ rotate: '-16deg' }],
    width: 210,
  },
  waypoint: {
    borderRadius: 5,
    height: 10,
    position: 'absolute',
    right: 116,
    top: 24,
    width: 10,
  },
  section: { gap: 8 },
  list: { gap: 10 },
  orderActions: { flexDirection: 'row', gap: 6 },
  bottomSpace: { height: 12 },
});
