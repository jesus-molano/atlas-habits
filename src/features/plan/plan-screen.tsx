import { useFocusEffect, useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { EmptyState, Screen, Text } from '@/components/core';
import { FeedbackSheet } from '@/components/core/feedback-overlay';
import { useAtlasApp } from '@/features/atlas';
import { HabitCard, RoutineCard, TaskCard } from '@/features/today';
import { ChoiceChip, PageHeader } from '@/features/ui';

type Filter = 'all' | 'habit' | 'task' | 'routine';

function todayKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function PlanScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [actionHabitId, setActionHabitId] = useState<string | null>(null);
  const {
    snapshot,
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

  useFocusEffect(
    useCallback(() => {
      setSelectedDate(todayKey());
    }, [setSelectedDate]),
  );

  const visibleCount = useMemo(() => {
    if (filter === 'habit') return snapshot.habits.length;
    if (filter === 'task') return snapshot.tasks.length;
    if (filter === 'routine') return snapshot.routines.length;
    return (
      snapshot.habits.length + snapshot.tasks.length + snapshot.routines.length
    );
  }, [filter, snapshot]);
  const actionHabit = snapshot.habits.find(
    (habit) => habit.id === actionHabitId,
  );
  const activeTimerItemId = snapshot.activeTimer?.itemId;

  return (
    <Screen
      contentContainerStyle={styles.content}
      safeAreaEdges={['top', 'left', 'right']}
      scroll
      scrollProps={{ keyboardDismissMode: 'on-drag' }}
    >
      <PageHeader
        actionIcon={Plus}
        actionLabel="Crear elemento"
        description={`${visibleCount} ${visibleCount === 1 ? 'elemento' : 'elementos'}`}
        eyebrow="Organiza"
        onAction={() => router.push('/create')}
        title="Plan"
      />

      <View accessibilityRole="radiogroup" style={styles.filters}>
        {(
          [
            ['all', 'Todo'],
            ['habit', 'Hábitos'],
            ['task', 'Tareas'],
            ['routine', 'Rutinas'],
          ] as const
        ).map(([value, label]) => (
          <ChoiceChip
            key={value}
            label={label}
            onPress={() => setFilter(value)}
            selected={filter === value}
          />
        ))}
      </View>

      {visibleCount === 0 ? (
        <EmptyState
          actionLabel="Crear ahora"
          description="Añade un hábito, una tarea o una rutina."
          onAction={() => router.push('/create')}
          title="Esta lista está vacía"
        />
      ) : null}

      {(filter === 'all' || filter === 'habit') &&
      snapshot.habits.length > 0 ? (
        <View style={styles.section}>
          <Text tone="muted" variant="eyebrow">
            HÁBITOS
          </Text>
          {snapshot.habits.map((habit) => (
            <HabitCard
              habit={habit}
              key={habit.id}
              onAdd={(amount) => addHabitValue(habit.id, amount)}
              onOpenActions={() => setActionHabitId(habit.id)}
              onOpenTimer={
                habit.metric === 'duration' &&
                (!activeTimerItemId || activeTimerItemId === habit.id)
                  ? () => openTimerSheet(habit.id)
                  : undefined
              }
              durationActionMode={
                activeTimerItemId === habit.id ? 'active' : 'timer'
              }
              onToggle={() => toggleHabit(habit.id)}
            />
          ))}
        </View>
      ) : null}

      {(filter === 'all' || filter === 'task') && snapshot.tasks.length > 0 ? (
        <View style={styles.section}>
          <Text tone="muted" variant="eyebrow">
            TAREAS
          </Text>
          {snapshot.tasks.map((task) => (
            <TaskCard
              key={task.id}
              onOpenActions={() => router.push(`/create?id=${task.id}`)}
              onOpenTimer={
                !activeTimerItemId || activeTimerItemId === task.id
                  ? () => openTimerSheet(task.id)
                  : undefined
              }
              onToggle={() => toggleTask(task.id)}
              onToggleSubtask={(subtaskId) => toggleSubtask(task.id, subtaskId)}
              task={task}
              timerActionMode={
                activeTimerItemId === task.id ? 'active' : 'start'
              }
            />
          ))}
        </View>
      ) : null}

      {(filter === 'all' || filter === 'routine') &&
      snapshot.routines.length > 0 ? (
        <View style={styles.section}>
          <Text tone="muted" variant="eyebrow">
            RUTINAS
          </Text>
          {snapshot.routines.map((routine) => (
            <RoutineCard
              key={routine.id}
              onOpenActions={() => router.push(`/create?id=${routine.id}`)}
              onPress={() => router.push(`/routine/${routine.id}`)}
              routine={routine}
            />
          ))}
        </View>
      ) : null}

      <FeedbackSheet
        actions={
          actionHabit
            ? [
                {
                  label: actionHabit.skipped
                    ? 'Deshacer omisión'
                    : 'Omitir hoy',
                  onPress: () => {
                    skipHabit(actionHabit.id, todayKey());
                    setActionHabitId(null);
                  },
                },
                {
                  label: 'Editar',
                  onPress: () => {
                    setActionHabitId(null);
                    router.push(`/create?id=${actionHabit.id}`);
                  },
                },
                actionHabit.paused
                  ? {
                      label: 'Reanudar',
                      onPress: () => {
                        resumeHabit(actionHabit.id);
                        setActionHabitId(null);
                      },
                    }
                  : {
                      label: 'Pausar sin fecha',
                      onPress: () => {
                        pauseHabit(actionHabit.id);
                        setActionHabitId(null);
                      },
                    },
              ]
            : []
        }
        message="Gestiona la continuidad de este hábito."
        onClose={() => setActionHabitId(null)}
        title={actionHabit?.title ?? 'Acciones del hábito'}
        visible={Boolean(actionHabit)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingBottom: 148, paddingTop: 8 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  section: { gap: 9 },
});
