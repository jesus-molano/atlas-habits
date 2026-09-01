import {
  AlarmClock,
  ChevronRight,
  Flag,
  Flame,
  Folder,
  MoreHorizontal,
  Minus,
  Pause,
  Play,
  Plus,
  Tag,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, IconButton, Text } from '@/components/core';
import { useTheme } from '@/design';
import {
  expectedCompletions,
  type HabitItem,
  type RoutineItem,
  type TaskItem,
} from '@/features/atlas';
import { CheckControl } from '@/features/ui';

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const remainder = total % 60;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0)
    return `${minutes} min ${remainder.toString().padStart(2, '0')} s`;
  return `${remainder} s`;
}

type ItemMetadataProps = {
  category?: string;
  deadlineAt?: string;
  notes?: string;
  tags: string[];
};

function ItemMetadata({
  category,
  deadlineAt,
  notes,
  tags,
}: ItemMetadataProps) {
  const theme = useTheme();
  const cleanTags = tags.filter((tag) => tag.trim().length > 0);
  const hasLabels = Boolean(category) || cleanTags.length > 0;

  if (!notes && !hasLabels && !deadlineAt) return null;

  return (
    <View style={styles.details}>
      {notes ? (
        <Text numberOfLines={3} tone="secondary" variant="caption">
          {notes}
        </Text>
      ) : null}
      {hasLabels ? (
        <View
          accessible
          accessibilityLabel={[
            category ? `Categoría: ${category}` : null,
            cleanTags.length > 0 ? `Etiquetas: ${cleanTags.join(', ')}` : null,
          ]
            .filter(Boolean)
            .join('. ')}
          style={styles.labelRow}
        >
          {category ? (
            <View
              style={[
                styles.metadataPill,
                { backgroundColor: theme.colors.surfaceMuted },
              ]}
            >
              <Folder color={theme.colors.textSecondary} size={13} />
              <Text numberOfLines={1} tone="secondary" variant="caption">
                {category}
              </Text>
            </View>
          ) : null}
          {cleanTags.map((tag) => (
            <View
              key={tag}
              style={[
                styles.metadataPill,
                { backgroundColor: theme.colors.surfaceMuted },
              ]}
            >
              <Tag color={theme.colors.textMuted} size={12} />
              <Text numberOfLines={1} tone="muted" variant="caption">
                {tag}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {deadlineAt ? (
        <View
          accessible
          accessibilityLabel={`Fecha límite: ${deadlineAt}`}
          style={styles.deadlineRow}
        >
          <Flag color={theme.colors.warning} size={14} />
          <Text tone="warning" variant="caption">
            Límite: {deadlineAt}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function metadataAccessibilityLabel({
  category,
  deadlineAt,
  notes,
  tags,
}: ItemMetadataProps): string {
  return [
    notes ? `Notas: ${notes}` : null,
    category ? `Categoría: ${category}` : null,
    tags.length > 0 ? `Etiquetas: ${tags.join(', ')}` : null,
    deadlineAt ? `Fecha límite: ${deadlineAt}` : null,
  ]
    .filter(Boolean)
    .join('. ');
}

type HabitCardProps = {
  habit: HabitItem;
  onToggle: () => void;
  onAdd: (amount: number) => void;
  onStartTimer: () => void;
  onStopTimer: () => void;
  onOpenActions?: () => void;
  timerAvailable?: boolean;
};

export function HabitCard({
  habit,
  onToggle,
  onAdd,
  onStartTimer,
  onStopTimer,
  onOpenActions,
  timerAvailable = true,
}: HabitCardProps) {
  const theme = useTheme();
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (habit.timerStartedAt === undefined) return;
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [habit.timerStartedAt]);

  const liveValue =
    habit.timerStartedAt === undefined
      ? habit.value
      : habit.value +
        Math.max(0, Math.round((now - habit.timerStartedAt) / 1_000));
  const effectiveTarget =
    habit.metric === 'boolean'
      ? expectedCompletions(habit.schedule)
      : habit.target;
  const progress = Math.min(1, liveValue / Math.max(1, effectiveTarget));
  const isComplete = liveValue >= effectiveTarget;
  const unavailable = habit.skipped === true || habit.paused === true;
  const detail =
    habit.metric === 'boolean'
      ? effectiveTarget > 1
        ? `${liveValue} de ${effectiveTarget} · ${habit.scheduleLabel}`
        : habit.scheduleLabel
      : habit.metric === 'duration'
        ? `${formatDuration(liveValue)} de ${formatDuration(habit.target)}`
        : `${liveValue} de ${habit.target} ${habit.unit}`;
  const statusDetail = habit.paused
    ? `Pausado${habit.pauseUntil ? ` hasta ${habit.pauseUntil}` : ''}`
    : habit.skipped
      ? 'Día omitido; la racha se mantiene'
      : detail;

  return (
    <Card
      accessibilityLabel={`${habit.title}. ${detail}`}
      padding="md"
      style={styles.card}
      variant={isComplete ? 'tinted' : 'default'}
    >
      <View style={styles.mainRow}>
        {habit.metric === 'boolean' ? (
          <CheckControl
            checked={isComplete}
            disabled={unavailable}
            label={`${isComplete ? 'Reiniciar' : 'Registrar'} ${habit.title}`}
            onPress={onToggle}
          />
        ) : (
          <View
            style={[
              styles.metricBubble,
              { backgroundColor: theme.colors.surfaceMuted },
            ]}
          >
            <Text color="primary" variant="label">
              {Math.round(progress * 100)}%
            </Text>
          </View>
        )}
        <View
          accessible
          accessibilityLabel={`${habit.title}. ${statusDetail}. Racha: ${habit.streak} ${habit.streak === 1 ? 'día' : 'días'}`}
          style={styles.copy}
        >
          <Text
            numberOfLines={2}
            style={isComplete ? styles.completedText : undefined}
            variant="bodyStrong"
          >
            {habit.title}
          </Text>
          <View style={styles.metaRow}>
            <Text
              numberOfLines={1}
              style={styles.metaText}
              tone="secondary"
              variant="caption"
            >
              {habit.paused
                ? `Pausado${habit.pauseUntil ? ` hasta ${habit.pauseUntil}` : ''}`
                : habit.skipped
                  ? 'Día omitido · la racha se mantiene'
                  : detail}
            </Text>
            <View style={styles.streak}>
              <Flame color={theme.colors.primary} size={14} strokeWidth={2.2} />
              <Text tone="muted" variant="caption">
                {habit.streak}
              </Text>
            </View>
          </View>
        </View>
        {onOpenActions ? (
          <IconButton
            accessibilityLabel={`Más acciones para ${habit.title}`}
            icon={MoreHorizontal}
            onPress={onOpenActions}
            size="compact"
            variant="ghost"
          />
        ) : null}
      </View>

      <ItemMetadata
        category={habit.category}
        notes={habit.notes}
        tags={habit.tags}
      />

      {habit.metric !== 'boolean' && !unavailable ? (
        <>
          <View
            accessibilityLabel={`Progreso de ${habit.title}: ${Math.round(progress * 100)}%`}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: habit.target, now: liveValue }}
            style={[styles.track, { backgroundColor: theme.colors.track }]}
          >
            <View
              style={[
                styles.fill,
                {
                  backgroundColor: theme.colors.primary,
                  width: `${progress * 100}%`,
                },
              ]}
            />
          </View>
          <View style={styles.quickActions}>
            {habit.metric === 'count' || !timerAvailable ? (
              <>
                <IconButton
                  accessibilityLabel={`Restar ${habit.metric === 'duration' ? 'un minuto' : `una ${habit.unit || 'unidad'}`} a ${habit.title}`}
                  icon={Minus}
                  onPress={() => onAdd(habit.metric === 'duration' ? -60 : -1)}
                  size="compact"
                  variant="tonal"
                />
                <Text
                  align="center"
                  style={styles.metricValue}
                  variant="metric"
                >
                  {habit.metric === 'duration'
                    ? formatDuration(liveValue)
                    : liveValue}
                </Text>
                <IconButton
                  accessibilityLabel={`Sumar ${habit.metric === 'duration' ? 'un minuto' : `una ${habit.unit || 'unidad'}`} a ${habit.title}`}
                  icon={Plus}
                  onPress={() => onAdd(habit.metric === 'duration' ? 60 : 1)}
                  size="compact"
                  variant="solid"
                />
              </>
            ) : (
              <Pressable
                accessibilityLabel={
                  habit.timerStartedAt === undefined
                    ? `Iniciar cronómetro de ${habit.title}`
                    : `Pausar cronómetro de ${habit.title}`
                }
                accessibilityRole="button"
                accessibilityState={{
                  selected: habit.timerStartedAt !== undefined,
                }}
                onPress={
                  habit.timerStartedAt === undefined
                    ? onStartTimer
                    : onStopTimer
                }
                style={({ pressed }) => [
                  styles.timerButton,
                  {
                    backgroundColor:
                      habit.timerStartedAt === undefined
                        ? theme.colors.primaryMuted
                        : theme.colors.primary,
                    borderColor: theme.colors.primary,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                {habit.timerStartedAt === undefined ? (
                  <Play
                    color={theme.colors.primary}
                    fill={theme.colors.primary}
                    size={18}
                  />
                ) : (
                  <Pause
                    color={theme.colors.textInverse}
                    fill={theme.colors.textInverse}
                    size={18}
                  />
                )}
                <Text
                  color={
                    habit.timerStartedAt === undefined
                      ? 'primary'
                      : 'textInverse'
                  }
                  variant="label"
                >
                  {habit.timerStartedAt === undefined ? 'Iniciar' : 'Pausar'}
                </Text>
              </Pressable>
            )}
          </View>
        </>
      ) : null}
    </Card>
  );
}

type TaskCardProps = {
  task: TaskItem;
  onToggle: () => void;
  onToggleSubtask: (subtaskId: string) => void;
  onOpenActions?: () => void;
};

export function TaskCard({
  task,
  onToggle,
  onToggleSubtask,
  onOpenActions,
}: TaskCardProps) {
  const theme = useTheme();
  const priority = {
    low: { label: 'Baja', color: theme.colors.info },
    medium: { label: 'Media', color: theme.colors.warning },
    high: { label: 'Alta', color: theme.colors.danger },
  }[task.priority];
  const dueAt = task.occurrenceDueAt ?? task.dueAt;
  const deadlineAt = task.occurrenceDeadlineAt ?? task.deadlineAt;

  return (
    <Card
      padding="md"
      style={styles.card}
      variant={task.completed ? 'tinted' : 'default'}
    >
      <View style={styles.mainRow}>
        <CheckControl
          checked={task.completed}
          label={`${task.completed ? 'Reabrir' : 'Completar'} ${task.title}`}
          onPress={onToggle}
        />
        <View
          accessible
          accessibilityLabel={`${task.title}. Prioridad ${priority.label}${dueAt ? `. Programada: ${dueAt}` : ''}`}
          style={styles.copy}
        >
          <Text
            numberOfLines={2}
            style={task.completed ? styles.completedText : undefined}
            variant="bodyStrong"
          >
            {task.title}
          </Text>
          <View style={styles.metaRow}>
            <View style={styles.priority}>
              <View style={[styles.dot, { backgroundColor: priority.color }]} />
              <Text tone="muted" variant="caption">
                {priority.label}
              </Text>
            </View>
            {dueAt ? (
              <View style={styles.priority}>
                <AlarmClock color={theme.colors.textMuted} size={14} />
                <Text tone="muted" variant="caption">
                  {dueAt}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        {onOpenActions ? (
          <IconButton
            accessibilityLabel={`Más acciones para ${task.title}`}
            icon={MoreHorizontal}
            onPress={onOpenActions}
            size="compact"
            variant="ghost"
          />
        ) : null}
      </View>
      <ItemMetadata
        category={task.category}
        deadlineAt={deadlineAt}
        notes={task.notes}
        tags={task.tags}
      />
      {task.subtasks.length > 0 ? (
        <View
          style={[styles.subtasks, { borderTopColor: theme.colors.border }]}
        >
          {task.subtasks.map((subtask) => (
            <Pressable
              accessibilityLabel={`${subtask.title}${subtask.required ? ', obligatorio' : ', opcional'}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: subtask.completed }}
              key={subtask.id}
              onPress={() => onToggleSubtask(subtask.id)}
              style={styles.subtaskRow}
            >
              <View
                style={[
                  styles.miniCheck,
                  {
                    backgroundColor: subtask.completed
                      ? theme.colors.primary
                      : 'transparent',
                    borderColor: subtask.completed
                      ? theme.colors.primary
                      : theme.colors.borderStrong,
                  },
                ]}
              />
              <Text
                style={[
                  styles.subtaskTitle,
                  subtask.completed && styles.completedText,
                ]}
                tone="secondary"
                variant="caption"
              >
                {subtask.title}
              </Text>
              {!subtask.required ? (
                <Text tone="muted" variant="caption">
                  opcional
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

type RoutineCardProps = {
  routine: RoutineItem;
  onPress: () => void;
  onOpenActions?: () => void;
};

export function RoutineCard({
  routine,
  onPress,
  onOpenActions,
}: RoutineCardProps) {
  const theme = useTheme();
  const completed = routine.steps.filter((step) => step.completed).length;
  const ratio =
    routine.steps.length === 0 ? 0 : completed / routine.steps.length;
  const routineMetadata = metadataAccessibilityLabel(routine);
  return (
    <Card
      accessibilityHint="Abre el modo guiado"
      accessibilityLabel={`${routine.title}. ${completed} de ${routine.steps.length} pasos${routineMetadata ? `. ${routineMetadata}` : ''}`}
      onPress={onPress}
      padding="lg"
      style={styles.card}
      variant="tinted"
    >
      <View style={styles.mainRow}>
        <View
          style={[
            styles.routineMark,
            {
              backgroundColor: theme.colors.primary,
              borderColor: theme.colors.primary,
            },
          ]}
        >
          <Play
            color={theme.colors.textInverse}
            fill={theme.colors.textInverse}
            size={18}
          />
        </View>
        <View style={styles.copy}>
          <Text numberOfLines={2} variant="subheading">
            {routine.title}
          </Text>
          <Text tone="secondary" variant="caption">
            {routine.completed
              ? 'Ruta completada'
              : routine.running
                ? `En marcha · ${completed}/${routine.steps.length} pasos`
                : `${routine.steps.length} pasos · ${routine.scheduleLabel}`}
          </Text>
        </View>
        {onOpenActions ? (
          <IconButton
            accessibilityLabel={`Más acciones para ${routine.title}`}
            icon={MoreHorizontal}
            onPress={onOpenActions}
            size="compact"
            variant="ghost"
          />
        ) : (
          <ChevronRight color={theme.colors.primary} size={22} />
        )}
      </View>
      <ItemMetadata
        category={routine.category}
        notes={routine.notes}
        tags={routine.tags}
      />
      <View
        accessibilityLabel={`Progreso de ${routine.title}: ${completed} de ${routine.steps.length} pasos`}
        accessibilityRole="progressbar"
        accessibilityValue={{
          min: 0,
          max: routine.steps.length,
          now: completed,
        }}
        style={[styles.track, { backgroundColor: theme.colors.track }]}
      >
        <View
          style={[
            styles.fill,
            { backgroundColor: theme.colors.primary, width: `${ratio * 100}%` },
          ]}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 14 },
  mainRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  copy: { flex: 1, gap: 4 },
  metaRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  metaText: { flexShrink: 1 },
  streak: { alignItems: 'center', flexDirection: 'row', gap: 3 },
  metricBubble: {
    alignItems: 'center',
    borderRadius: 15,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  track: { borderRadius: 999, height: 6, overflow: 'hidden' },
  fill: { borderRadius: 999, height: '100%' },
  quickActions: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    flexDirection: 'row',
    gap: 12,
  },
  metricValue: { minWidth: 48 },
  timerButton: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 18,
  },
  completedText: { opacity: 0.55, textDecorationLine: 'line-through' },
  details: { gap: 8, marginLeft: 60 },
  labelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metadataPill: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 5,
    maxWidth: '100%',
    minHeight: 28,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  deadlineRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  priority: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  dot: { borderRadius: 4, height: 7, width: 7 },
  subtasks: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
    paddingTop: 10,
  },
  subtaskRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
    minHeight: 40,
    paddingHorizontal: 2,
  },
  miniCheck: { borderRadius: 6, borderWidth: 1.5, height: 20, width: 20 },
  subtaskTitle: { flex: 1 },
  routineMark: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
});
