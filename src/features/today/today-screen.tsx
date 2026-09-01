import { useRouter } from 'expo-router';
import { CalendarDays, LocateFixed, Map, Plus } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  type ListRenderItemInfo,
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
import { useAtlasApp } from '@/features/atlas';
import { PageHeader } from '@/features/ui';

import { HabitCard, RoutineCard, TaskCard } from './item-cards';
import {
  TODAY_DATE_STRIP_INDICES,
  todayDateStripDateAt,
  todayDateStripIndexForDate,
  todayDateStripSafeSelection,
} from './today-date-strip';

const DATE_CELL_WIDTH = 58;
const DATE_CELL_GAP = 8;
const DATE_CELL_STRIDE = DATE_CELL_WIDTH + DATE_CELL_GAP;

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
  todayDate,
  onSelect,
}: {
  selectedDate: string;
  todayDate: string;
  onSelect: (date: string) => void;
}) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const listRef = useRef<FlatList<number>>(null);
  const positionedRef = useRef(false);
  const [stripWidth, setStripWidth] = useState(0);
  const dateCellHeight = Math.round(
    64 + Math.max(0, Math.min(fontScale, 2) - 1) * 32,
  );
  const safeSelectedDate = todayDateStripSafeSelection(selectedDate, todayDate);
  const selectedIndex = todayDateStripIndexForDate(selectedDate, todayDate);
  const sideInset = Math.max(0, (stripWidth - DATE_CELL_WIDTH) / 2);

  useEffect(() => {
    if (stripWidth === 0) return;

    const frame = requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({
        animated: positionedRef.current,
        offset: selectedIndex * DATE_CELL_STRIDE,
      });
      positionedRef.current = true;
    });

    return () => cancelAnimationFrame(frame);
  }, [selectedIndex, stripWidth]);

  const renderDay = ({ item: index }: ListRenderItemInfo<number>) => {
    const key = todayDateStripDateAt(index, todayDate);
    const date = new Date(`${key}T12:00:00`);
    const selected = key === safeSelectedDate;
    const isCurrentDay = key === todayDate;

    return (
      <Pressable
        accessibilityLabel={`${date.toLocaleDateString('es-ES', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}${isCurrentDay ? ', hoy' : ''}${selected ? ', seleccionada' : ''}`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => onSelect(key)}
        style={({ pressed }) => [
          styles.dateCell,
          { height: dateCellHeight },
          {
            backgroundColor: selected
              ? theme.colors.primary
              : theme.colors.surface,
            borderColor: selected ? theme.colors.primary : theme.colors.border,
            opacity: pressed ? 0.76 : 1,
          },
        ]}
      >
        <Text color={selected ? 'textInverse' : 'textMuted'} variant="eyebrow">
          {date.toLocaleDateString('es-ES', { weekday: 'short' }).slice(0, 2)}
        </Text>
        <Text color={selected ? 'textInverse' : 'text'} variant="bodyStrong">
          {date.getDate()}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      onLayout={(event) => setStripWidth(event.nativeEvent.layout.width)}
      style={[styles.dateStrip, { height: dateCellHeight }]}
    >
      <FlatList
        ref={listRef}
        data={TODAY_DATE_STRIP_INDICES}
        decelerationRate="fast"
        disableIntervalMomentum
        getItemLayout={(_, index) => ({
          index,
          length: DATE_CELL_STRIDE,
          offset: DATE_CELL_STRIDE * index,
        })}
        horizontal
        initialNumToRender={9}
        initialScrollIndex={selectedIndex}
        ItemSeparatorComponent={() => (
          <View accessibilityElementsHidden style={styles.dateSeparator} />
        )}
        keyExtractor={(index) => String(index)}
        maxToRenderPerBatch={9}
        onScrollToIndexFailed={() => {
          requestAnimationFrame(() => {
            listRef.current?.scrollToOffset({
              animated: false,
              offset: selectedIndex * DATE_CELL_STRIDE,
            });
          });
        }}
        renderItem={renderDay}
        showsHorizontalScrollIndicator={false}
        snapToAlignment="start"
        snapToInterval={DATE_CELL_STRIDE}
        windowSize={7}
        contentContainerStyle={{ paddingLeft: sideInset }}
      />
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

function PassiveEmpty({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.passiveEmpty,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <Text tone="secondary" variant="caption">
        {title}
      </Text>
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
    selectedTasks,
    selectedRoutines,
    isToday,
    progress,
    historicalDayStatus,
    historicalDayMessage,
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
  const selectedDateObject = new Date(`${selectedDate}T12:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pauseMinimumDate = new Date(today);
  pauseMinimumDate.setDate(pauseMinimumDate.getDate() + 1);
  const todayKey = localDateKey(today);
  const pauseMinimumDateKey = localDateKey(pauseMinimumDate);
  const safeSelectedDate = todayDateStripSafeSelection(selectedDate, todayKey);
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
  const activeTimerItemId = snapshot.activeTimer?.itemId;

  useEffect(() => {
    if (selectedDate !== safeSelectedDate) {
      setSelectedDate(safeSelectedDate);
    }
  }, [safeSelectedDate, selectedDate, setSelectedDate]);

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
      <PageHeader description={dateLabel} eyebrow="Atlas diario" title="Hoy" />

      <TodayDateStrip
        onSelect={setSelectedDate}
        selectedDate={selectedDate}
        todayDate={todayKey}
      />
      <View style={styles.dateActions}>
        <Button
          fullWidth={isToday}
          label="Elegir otra fecha"
          leadingIcon={CalendarDays}
          onPress={() => setDatePickerMode('history')}
          size="sm"
          style={!isToday ? styles.dateAction : undefined}
          variant="ghost"
        />
        {!isToday ? (
          <Pressable
            accessibilityLabel={`Volver a hoy, ${new Date(
              `${todayKey}T12:00:00`,
            ).toLocaleDateString('es-ES', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}`}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setSelectedDate(todayKey)}
            style={({ pressed }) => [
              styles.todayShortcut,
              { opacity: pressed ? 0.58 : 1 },
            ]}
          >
            <LocateFixed color={theme.colors.primary} size={15} />
            <Text color="primary" variant="caption">
              Hoy
            </Text>
          </Pressable>
        ) : null}
      </View>

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
                : 'Marca tu siguiente acción.'}
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
          <View style={styles.historicalStatus}>
            {historicalDayStatus === 'loading' ? (
              <ActivityIndicator color={theme.colors.primary} size="small" />
            ) : null}
            <View style={styles.historicalStatusCopy}>
              <Text variant="label">Registro del día</Text>
              <Text tone="secondary" variant="caption">
                {historicalDayMessage ??
                  (historicalDayStatus === 'loading'
                    ? 'Cargando hábitos, tareas y rutinas…'
                    : 'Puedes corregir lo que ocurrió. Crea o edita definiciones desde Hoy o Plan.')}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      <View style={styles.section}>
        <SectionHeader title="Hábitos" />
        <View style={styles.list}>
          {selectedHabits.length === 0 ? (
            isToday ? (
              <InlineEmpty
                actionLabel="Crear hábito"
                onPress={() => router.push('/create?type=habit')}
                title="No hay hábitos programados."
              />
            ) : (
              <PassiveEmpty title="No había hábitos programados." />
            )
          ) : (
            selectedHabits.map((habit) => (
              <HabitCard
                habit={habit}
                key={habit.id}
                onAdd={(amount) => addHabitValue(habit.id, amount)}
                onOpenActions={() => setActionHabitId(habit.id)}
                onOpenTimer={
                  habit.metric === 'duration' &&
                  (!isToday ||
                    !activeTimerItemId ||
                    activeTimerItemId === habit.id)
                    ? () => openTimerSheet(habit.id)
                    : undefined
                }
                durationActionMode={
                  activeTimerItemId === habit.id
                    ? 'active'
                    : isToday
                      ? 'timer'
                      : 'manual'
                }
                onToggle={() => toggleHabit(habit.id)}
              />
            ))
          )}
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Tareas" />
        <View style={styles.list}>
          {selectedTasks.length === 0 ? (
            isToday ? (
              <InlineEmpty
                actionLabel="Crear tarea"
                onPress={() => router.push('/create?type=task')}
                title="No hay tareas para hoy."
              />
            ) : (
              <PassiveEmpty title="No había tareas programadas." />
            )
          ) : (
            selectedTasks.map((task) => (
              <TaskCard
                key={task.id}
                onOpenTimer={
                  isToday &&
                  (!activeTimerItemId || activeTimerItemId === task.id)
                    ? () => openTimerSheet(task.id)
                    : undefined
                }
                onToggle={() => toggleTask(task.id, selectedDate)}
                onToggleSubtask={(subtaskId) =>
                  toggleSubtask(task.id, subtaskId, selectedDate)
                }
                task={task}
                timerActionMode={
                  activeTimerItemId === task.id ? 'active' : 'start'
                }
              />
            ))
          )}
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Rutinas" />
        <View style={styles.list}>
          {selectedRoutines.length === 0 ? (
            isToday ? (
              <InlineEmpty
                actionLabel="Crear rutina"
                onPress={() => router.push('/create?type=routine')}
                title="No hay rutinas para hoy."
              />
            ) : (
              <PassiveEmpty title="No había rutinas programadas." />
            )
          ) : (
            selectedRoutines.map((routine) => (
              <RoutineCard
                key={routine.id}
                onPress={() =>
                  router.push(
                    isToday
                      ? `/routine/${routine.id}`
                      : `/routine/${routine.id}?date=${selectedDate}`,
                  )
                }
                routine={routine}
              />
            ))
          )}
        </View>
      </View>

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
                ...(isToday
                  ? [
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
                  : []),
              ]
            : []
        }
        message={
          isToday
            ? 'Ajusta este hábito sin perder el contexto del día.'
            : 'Corrige únicamente el registro de esta fecha.'
        }
        onClose={() => setActionHabitId(null)}
        title={actionHabit?.title ?? 'Acciones del hábito'}
        visible={Boolean(actionHabit)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 148, paddingTop: 8 },
  dateStrip: { width: '100%' },
  dateCell: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    gap: 1,
    justifyContent: 'center',
    width: DATE_CELL_WIDTH,
  },
  dateSeparator: { width: DATE_CELL_GAP },
  dateActions: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  dateAction: { flex: 1 },
  todayShortcut: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 8,
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
  passiveEmpty: {
    borderRadius: 14,
    borderStyle: 'dashed',
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 58,
    paddingHorizontal: 14,
  },
  historicalStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  historicalStatusCopy: { flex: 1, gap: 2 },
});
