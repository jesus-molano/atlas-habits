import { useFocusEffect, useRouter } from 'expo-router';
import { CalendarRange, ListFilter, Plus } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Card, EmptyState, Screen, Text } from '@/components/core';
import { useTheme } from '@/design';
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
  const theme = useTheme();
  const [filter, setFilter] = useState<Filter>('all');
  const {
    snapshot,
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
  } = useAtlasApp();

  useFocusEffect(
    useCallback(() => {
      // Plan exposes live completion controls, so they must always operate on
      // today rather than a historical date previously selected in Hoy.
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

  const openHabitActions = (habitId: string) => {
    const habit = snapshot.habits.find((item) => item.id === habitId);
    if (!habit) return;
    Alert.alert(habit.title, 'Gestiona la continuidad de este hábito.', [
      {
        text: habit.skipped ? 'Deshacer omisión de hoy' : 'Omitir hoy',
        onPress: () => skipHabit(habit.id, todayKey()),
      },
      { text: 'Editar', onPress: () => router.push(`/create?id=${habit.id}`) },
      habit.paused
        ? { text: 'Reanudar', onPress: () => resumeHabit(habit.id) }
        : { text: 'Pausar sin fecha', onPress: () => pauseHabit(habit.id) },
    ]);
  };

  return (
    <Screen
      contentContainerStyle={styles.content}
      safeAreaEdges={['top', 'left', 'right']}
      scroll
    >
      <PageHeader
        actionIcon={Plus}
        actionLabel="Crear elemento"
        description="Todo lo que has trazado, en una sola vista."
        eyebrow="Mapa"
        onAction={() => router.push('/create')}
        title="Plan"
      />

      <View accessibilityRole="radiogroup" style={styles.filters}>
        <ChoiceChip
          label="Todo"
          onPress={() => setFilter('all')}
          selected={filter === 'all'}
        />
        <ChoiceChip
          label="Hábitos"
          onPress={() => setFilter('habit')}
          selected={filter === 'habit'}
        />
        <ChoiceChip
          label="Tareas"
          onPress={() => setFilter('task')}
          selected={filter === 'task'}
        />
        <ChoiceChip
          label="Rutinas"
          onPress={() => setFilter('routine')}
          selected={filter === 'routine'}
        />
      </View>

      <Card padding="md" style={styles.summary} variant="outlined">
        <View style={styles.summaryIcon}>
          <CalendarRange color={theme.colors.primary} size={20} />
        </View>
        <View style={styles.summaryCopy}>
          <Text variant="bodyStrong">{visibleCount} elementos visibles</Text>
          <Text tone="secondary" variant="caption">
            Los cambios se guardan en este dispositivo al instante.
          </Text>
        </View>
        <ListFilter color={theme.colors.textMuted} size={20} />
      </Card>

      {visibleCount === 0 ? (
        <EmptyState
          actionLabel="Crear ahora"
          description="Añade un nuevo punto para empezar a construir tu mapa."
          onAction={() => router.push('/create')}
          title="Esta zona está vacía"
        />
      ) : null}

      {(filter === 'all' || filter === 'routine') &&
      snapshot.routines.length > 0 ? (
        <View style={styles.section}>
          <Text tone="muted" variant="eyebrow">
            RUTINAS GUIADAS
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
              onStartTimer={() => startHabitTimer(habit.id)}
              onStopTimer={() => stopHabitTimer(habit.id)}
              onToggle={() => toggleHabit(habit.id)}
              onOpenActions={() => openHabitActions(habit.id)}
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
              onToggle={() => toggleTask(task.id)}
              onToggleSubtask={(subtaskId) => toggleSubtask(task.id, subtaskId)}
              onOpenActions={() => router.push(`/create?id=${task.id}`)}
              task={task}
            />
          ))}
        </View>
      ) : null}
      <View style={styles.bottomSpace} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 22, paddingBottom: 112, paddingTop: 12 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summary: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  summaryIcon: { alignItems: 'center', justifyContent: 'center', width: 32 },
  summaryCopy: { flex: 1, gap: 2 },
  section: { gap: 10 },
  bottomSpace: { height: 12 },
});
