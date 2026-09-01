import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Bell,
  CheckCircle2,
  ChevronLeft,
  CircleDot,
  Clock3,
  Hash,
  Plus,
  Repeat2,
  Route,
  Trash2,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, IconButton, Text } from '@/components/core';
import { useTheme } from '@/design';
import {
  createDefaultSchedule,
  localDateToday,
  useAtlasApp,
  type AtlasReminder,
  type AtlasSchedule,
  type AtlasWeekday,
  type CreateItemDraft,
  type HabitMetric,
  type Priority,
} from '@/features/atlas';
import { ChoiceChip, FormField } from '@/features/ui';

import {
  normalizeLocalDate,
  normalizeLocalDateTime,
  normalizeLocalTime,
  parseNonNegativeInteger,
  parsePositiveDecimal,
  parsePositiveInteger,
  suggestReminderTime,
} from './form-validation';

type CreateKind = CreateItemDraft['kind'];

type DraftLine = {
  id: string;
  title: string;
  required: boolean;
  minutes?: string;
};

type DraftReminder = AtlasReminder;

const weekdays: { day: AtlasWeekday; label: string }[] = [
  { day: 1, label: 'L' },
  { day: 2, label: 'M' },
  { day: 3, label: 'X' },
  { day: 4, label: 'J' },
  { day: 5, label: 'V' },
  { day: 6, label: 'S' },
  { day: 7, label: 'D' },
];

function draftId(): string {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function SwitchRow({
  icon: Icon,
  title,
  description,
  value,
  onValueChange,
}: {
  icon: typeof Bell;
  title: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => onValueChange(!value)}
      style={styles.switchRow}
    >
      <View
        style={[
          styles.switchIcon,
          { backgroundColor: theme.colors.surfaceMuted },
        ]}
      >
        <Icon color={theme.colors.primary} size={20} />
      </View>
      <View style={styles.switchCopy}>
        <Text variant="bodyStrong">{title}</Text>
        <Text tone="secondary" variant="caption">
          {description}
        </Text>
      </View>
      <Switch
        accessibilityElementsHidden
        onValueChange={onValueChange}
        thumbColor={value ? theme.colors.primary : theme.colors.textMuted}
        trackColor={{
          false: theme.colors.track,
          true: theme.colors.primaryMuted,
        }}
        value={value}
      />
    </Pressable>
  );
}

function DraftLines({
  kind,
  lines,
  onChange,
}: {
  kind: 'checklist' | 'steps';
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
}) {
  const theme = useTheme();

  const update = (id: string, patch: Partial<DraftLine>) => {
    onChange(
      lines.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
  };

  return (
    <View style={styles.formGroup}>
      <View style={styles.fieldHeading}>
        <View style={styles.fieldHeadingCopy}>
          <Text variant="label">
            {kind === 'steps' ? 'Pasos' : 'Checklist'}
          </Text>
          <Text tone="muted" variant="caption">
            {kind === 'steps'
              ? 'El modo guiado los mostrará en este orden.'
              : 'Marca cuáles son necesarias para cerrar la tarea.'}
          </Text>
        </View>
        <IconButton
          accessibilityLabel={
            kind === 'steps' ? 'Añadir paso' : 'Añadir subtarea'
          }
          icon={Plus}
          onPress={() =>
            onChange([
              ...lines,
              { id: draftId(), title: '', required: true, minutes: '' },
            ])
          }
          size="compact"
          variant="tonal"
        />
      </View>
      {lines.map((line, index) => (
        <Card
          key={line.id}
          padding="sm"
          style={styles.lineCard}
          variant="outlined"
        >
          <View style={styles.lineTop}>
            <View
              style={[
                styles.lineIndex,
                { backgroundColor: theme.colors.primaryMuted },
              ]}
            >
              <Text color="primary" variant="caption">
                {index + 1}
              </Text>
            </View>
            <View style={styles.lineInputWrap}>
              <FormField
                label={
                  kind === 'steps'
                    ? `Paso ${index + 1}`
                    : `Subtarea ${index + 1}`
                }
                onChangeText={(title) => update(line.id, { title })}
                placeholder={
                  kind === 'steps'
                    ? 'Ej. Preparar la mochila'
                    : 'Ej. Revisar la despensa'
                }
                value={line.title}
              />
            </View>
            <IconButton
              accessibilityLabel={`Eliminar ${kind === 'steps' ? 'paso' : 'subtarea'} ${index + 1}`}
              disabled={lines.length === 1}
              icon={Trash2}
              onPress={() =>
                onChange(lines.filter((item) => item.id !== line.id))
              }
              size="compact"
              variant="danger"
            />
          </View>
          <View style={styles.lineOptions}>
            <ChoiceChip
              label={line.required ? 'Obligatorio' : 'Opcional'}
              onPress={() => update(line.id, { required: !line.required })}
              selected={line.required}
            />
            {kind === 'steps' ? (
              <View style={styles.durationField}>
                <FormField
                  keyboardType="number-pad"
                  label="Temporizador"
                  onChangeText={(minutes) => update(line.id, { minutes })}
                  placeholder="min"
                  value={line.minutes}
                />
              </View>
            ) : null}
          </View>
        </Card>
      ))}
    </View>
  );
}

function ReminderLines({
  reminders,
  onChange,
  timeErrors,
}: {
  reminders: DraftReminder[];
  onChange: (reminders: DraftReminder[]) => void;
  timeErrors: Readonly<Record<string, string | undefined>>;
}) {
  const update = (id: string, patch: Partial<DraftReminder>) => {
    onChange(
      reminders.map((reminder) =>
        reminder.id === id ? { ...reminder, ...patch } : reminder,
      ),
    );
  };

  return (
    <View style={styles.formGroup}>
      <View style={styles.fieldHeading}>
        <View style={styles.fieldHeadingCopy}>
          <Text variant="label">Horas</Text>
          <Text tone="muted" variant="caption">
            Añade una o varias franjas. Cada una puede avisarte de forma exacta.
          </Text>
        </View>
        <IconButton
          accessibilityLabel="Añadir hora de recordatorio"
          icon={Plus}
          onPress={() =>
            onChange([
              ...reminders,
              {
                id: draftId(),
                time: suggestReminderTime(
                  reminders.map((reminder) => reminder.time),
                ),
                enabled: true,
                snoozeMinutes: 10,
              },
            ])
          }
          size="compact"
          variant="tonal"
        />
      </View>
      {reminders.map((reminder, index) => (
        <Card
          key={reminder.id}
          padding="sm"
          style={styles.reminderCard}
          variant="outlined"
        >
          <View style={styles.twoColumns}>
            <View style={styles.column}>
              <FormField
                autoCapitalize="none"
                autoCorrect={false}
                error={timeErrors[reminder.id]}
                label={`Hora ${index + 1}`}
                maxLength={5}
                onChangeText={(time) => update(reminder.id, { time })}
                placeholder="09:00"
                value={reminder.time}
              />
            </View>
            <View style={styles.column}>
              <FormField
                label="Etiqueta"
                onChangeText={(label) => update(reminder.id, { label })}
                placeholder="Mañana"
                value={reminder.label ?? ''}
              />
            </View>
            <IconButton
              accessibilityLabel={`Eliminar hora ${index + 1}`}
              icon={Trash2}
              onPress={() =>
                onChange(reminders.filter((item) => item.id !== reminder.id))
              }
              size="compact"
              style={styles.reminderDelete}
              variant="danger"
            />
          </View>
        </Card>
      ))}
    </View>
  );
}

export function CreateScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; id?: string }>();
  const { snapshot, createItem, updateItem, deleteItem } = useAtlasApp();
  const existing = [
    ...snapshot.habits,
    ...snapshot.tasks,
    ...snapshot.routines,
  ].find((item) => item.id === params.id);
  const initialKind: CreateKind =
    existing?.kind ??
    (params.type === 'task' ||
    params.type === 'routine' ||
    params.type === 'habit'
      ? params.type
      : 'habit');
  const theme = useTheme();
  const [kind, setKind] = useState<CreateKind>(initialKind);
  const existingHabit = existing?.kind === 'habit' ? existing : undefined;
  const existingTask = existing?.kind === 'task' ? existing : undefined;
  const existingRoutine = existing?.kind === 'routine' ? existing : undefined;
  const initialSchedule = existing?.schedule ?? createDefaultSchedule();
  const dueParts = existingTask?.dueAt?.split(' · ') ?? [];
  const [title, setTitle] = useState(existing?.title ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [category, setCategory] = useState(existing?.category ?? '');
  const [tags, setTags] = useState(existing?.tags.join(', ') ?? '');
  const [scheduleKind, setScheduleKind] = useState<AtlasSchedule['kind']>(
    initialSchedule.kind === 'once' ? 'daily' : initialSchedule.kind,
  );
  const [scheduleStartDate, setScheduleStartDate] = useState(
    initialSchedule.startDate || localDateToday(),
  );
  const [scheduleDays, setScheduleDays] = useState<AtlasWeekday[]>(
    initialSchedule.kind === 'weekdays'
      ? initialSchedule.days
      : [1, 2, 3, 4, 5],
  );
  const [intervalEvery, setIntervalEvery] = useState(
    initialSchedule.kind === 'interval_days' ? `${initialSchedule.every}` : '2',
  );
  const [intervalAnchor, setIntervalAnchor] = useState(
    initialSchedule.kind === 'interval_days'
      ? initialSchedule.anchorDate
      : initialSchedule.startDate,
  );
  const [quota, setQuota] = useState(
    initialSchedule.kind === 'period_quota' ? `${initialSchedule.quota}` : '3',
  );
  const [quotaPeriod, setQuotaPeriod] = useState<'week' | 'month'>(
    initialSchedule.kind === 'period_quota' ? initialSchedule.period : 'week',
  );
  const [reminderEnabled, setReminderEnabled] = useState(
    (existing?.reminders.length ?? 0) > 0,
  );
  const [reminders, setReminders] = useState<DraftReminder[]>(
    existing?.reminders.length
      ? existing.reminders
      : [{ id: draftId(), time: '09:00', enabled: true, snoozeMinutes: 10 }],
  );
  const [metric, setMetric] = useState<HabitMetric>(
    existingHabit?.metric ?? 'boolean',
  );
  const [target, setTarget] = useState(
    existingHabit
      ? `${existingHabit.metric === 'duration' ? existingHabit.target / 60 : existingHabit.target}`
      : '1',
  );
  const [unit, setUnit] = useState(existingHabit?.unit ?? 'veces');
  const [graceMinutes, setGraceMinutes] = useState(
    existingHabit?.graceMinutes ? `${existingHabit.graceMinutes}` : '60',
  );
  const [priority, setPriority] = useState<Priority>(
    existingTask?.priority ?? 'medium',
  );
  const [dueDate, setDueDate] = useState(dueParts[0] ?? '');
  const [dueTime, setDueTime] = useState(dueParts[1] ?? '');
  const [deadline, setDeadline] = useState(existingTask?.deadlineAt ?? '');
  const [recurring, setRecurring] = useState(existingTask?.recurring ?? false);
  const [subtasks, setSubtasks] = useState<DraftLine[]>(
    existingTask?.subtasks.length
      ? existingTask.subtasks.map((subtask) => ({
          id: subtask.id,
          title: subtask.title,
          required: subtask.required,
        }))
      : [{ id: draftId(), title: '', required: true }],
  );
  const [steps, setSteps] = useState<DraftLine[]>(
    existingRoutine?.steps.length
      ? existingRoutine.steps.map((step) => ({
          id: step.id,
          title: step.title,
          required: step.required,
          minutes: step.durationSeconds ? `${step.durationSeconds / 60}` : '',
        }))
      : [{ id: draftId(), title: '', required: true, minutes: '' }],
  );
  const [submitted, setSubmitted] = useState(false);
  const hasScheduleEditor = kind === 'habit' || kind === 'routine' || recurring;
  const normalizedDueDate = normalizeLocalDate(dueDate);
  const normalizedDueTime = normalizeLocalTime(dueTime);
  const normalizedDeadline = deadline.trim()
    ? normalizeLocalDateTime(deadline)
    : undefined;
  const normalizedStartDate = normalizeLocalDate(scheduleStartDate);
  const normalizedAnchorDate = normalizeLocalDate(intervalAnchor);
  const intervalEveryValue = parsePositiveInteger(intervalEvery);
  const quotaValue = parsePositiveInteger(quota);
  const targetValue = metric === 'boolean' ? 1 : parsePositiveDecimal(target);
  const graceMinutesValue = parseNonNegativeInteger(graceMinutes);
  const reminderTimes = reminders.map((reminder) => ({
    id: reminder.id,
    time: normalizeLocalTime(reminder.time),
  }));
  const reminderTimeCounts = new Map<string, number>();
  for (const { time } of reminderTimes) {
    if (time)
      reminderTimeCounts.set(time, (reminderTimeCounts.get(time) ?? 0) + 1);
  }
  const reminderTimeErrors = Object.fromEntries(
    reminderTimes.map(({ id, time }) => [
      id,
      !submitted || !reminderEnabled
        ? undefined
        : !time
          ? 'Usa HH:MM entre 00:00 y 23:59.'
          : (reminderTimeCounts.get(time) ?? 0) > 1
            ? 'Esta hora está repetida.'
            : undefined,
    ]),
  );
  const invalidReminder =
    reminderEnabled &&
    (reminders.length === 0 ||
      reminderTimes.some(
        ({ time }) => !time || (reminderTimeCounts.get(time) ?? 0) > 1,
      ));
  const titleError =
    submitted && !title.trim() ? 'Escribe un nombre.' : undefined;
  const dueDateError =
    submitted && kind === 'task' && !normalizedDueDate
      ? 'Escribe una fecha real con formato AAAA-MM-DD.'
      : undefined;
  const dueTimeError =
    submitted && kind === 'task' && !normalizedDueTime
      ? 'Usa HH:MM entre 00:00 y 23:59.'
      : undefined;
  const deadlineError =
    submitted && kind === 'task' && deadline.trim() && !normalizedDeadline
      ? 'Usa AAAA-MM-DD · HH:MM o déjalo vacío.'
      : undefined;
  const scheduleStartError =
    submitted && hasScheduleEditor && !normalizedStartDate
      ? 'Escribe una fecha real con formato AAAA-MM-DD.'
      : undefined;
  const weekdaysError =
    submitted &&
    hasScheduleEditor &&
    scheduleKind === 'weekdays' &&
    scheduleDays.length === 0
      ? 'Selecciona al menos un día.'
      : undefined;
  const intervalEveryError =
    submitted &&
    hasScheduleEditor &&
    scheduleKind === 'interval_days' &&
    !intervalEveryValue
      ? 'Escribe un número entero mayor que cero.'
      : undefined;
  const intervalAnchorError =
    submitted &&
    hasScheduleEditor &&
    scheduleKind === 'interval_days' &&
    !normalizedAnchorDate
      ? 'Escribe una fecha real con formato AAAA-MM-DD.'
      : undefined;
  const quotaError =
    submitted &&
    hasScheduleEditor &&
    scheduleKind === 'period_quota' &&
    !quotaValue
      ? 'Escribe un número entero mayor que cero.'
      : undefined;
  const targetError =
    submitted && kind === 'habit' && metric !== 'boolean' && !targetValue
      ? 'Escribe un objetivo mayor que cero.'
      : undefined;
  const graceMinutesError =
    submitted && kind === 'habit' && graceMinutesValue === null
      ? 'Escribe cero o un número entero positivo.'
      : undefined;
  const stepsError =
    submitted && kind === 'routine' && !steps.some((step) => step.title.trim())
      ? 'Añade al menos un paso.'
      : undefined;

  const validationMessages = [
    !title.trim() ? 'Escribe un nombre.' : undefined,
    kind === 'task' && !normalizedDueDate
      ? 'Revisa la fecha de la tarea.'
      : undefined,
    kind === 'task' && !normalizedDueTime
      ? 'Revisa la hora de la tarea.'
      : undefined,
    kind === 'task' && deadline.trim() && !normalizedDeadline
      ? 'Revisa la fecha límite.'
      : undefined,
    hasScheduleEditor && !normalizedStartDate
      ? 'Revisa la fecha de inicio.'
      : undefined,
    hasScheduleEditor &&
    scheduleKind === 'weekdays' &&
    scheduleDays.length === 0
      ? 'Selecciona al menos un día de repetición.'
      : undefined,
    hasScheduleEditor && scheduleKind === 'interval_days' && !intervalEveryValue
      ? 'Revisa el intervalo de días.'
      : undefined,
    hasScheduleEditor &&
    scheduleKind === 'interval_days' &&
    !normalizedAnchorDate
      ? 'Revisa la fecha de ancla.'
      : undefined,
    hasScheduleEditor && scheduleKind === 'period_quota' && !quotaValue
      ? 'Revisa el número de veces de la cuota.'
      : undefined,
    kind === 'habit' && metric !== 'boolean' && !targetValue
      ? 'Revisa el objetivo del hábito.'
      : undefined,
    kind === 'habit' && graceMinutesValue === null
      ? 'Revisa el margen de cierre.'
      : undefined,
    kind === 'routine' && !steps.some((step) => step.title.trim())
      ? 'Añade al menos un paso a la rutina.'
      : undefined,
    reminderEnabled && reminders.length === 0
      ? 'Añade una hora de recordatorio o desactiva «Avisarme».'
      : undefined,
    invalidReminder && reminders.length > 0
      ? 'Corrige las horas de recordatorio repetidas o no válidas.'
      : undefined,
  ].filter((message): message is string => Boolean(message));

  const submitLabel = useMemo(() => {
    if (existing) return 'Guardar cambios';
    return {
      habit: 'Crear hábito',
      task: 'Crear tarea',
      routine: 'Crear rutina',
    }[kind];
  }, [existing, kind]);

  const commit = (draft: CreateItemDraft) => {
    if (existing) updateItem(existing.id, draft);
    else createItem(draft);
  };

  const buildSchedule = (): {
    schedule: AtlasSchedule;
    reminders: AtlasReminder[];
  } => {
    const activeReminders = (reminderEnabled ? reminders : []).map(
      (reminder) => ({
        ...reminder,
        time: normalizeLocalTime(reminder.time)!,
        label: reminder.label?.trim() || undefined,
        scheduleSlotId: reminder.scheduleSlotId ?? `slot-${reminder.id}`,
        enabled: true,
        snoozeMinutes: Math.max(1, reminder.snoozeMinutes || 10),
      }),
    );
    const slots = activeReminders.map((reminder) => ({
      id: reminder.scheduleSlotId!,
      time: reminder.time,
      ...(reminder.label ? { label: reminder.label } : {}),
    }));
    const startDate = normalizedStartDate ?? localDateToday();

    if (kind === 'task' && !recurring) {
      const date = normalizedDueDate ?? startDate;
      return {
        schedule: { kind: 'once', date, startDate: date, slots },
        reminders: activeReminders,
      };
    }

    let schedule: AtlasSchedule;
    switch (scheduleKind) {
      case 'weekdays':
        schedule = { kind: 'weekdays', days: scheduleDays, startDate, slots };
        break;
      case 'interval_days':
        schedule = {
          kind: 'interval_days',
          every: intervalEveryValue ?? 1,
          anchorDate: normalizedAnchorDate ?? startDate,
          startDate,
          slots,
        };
        break;
      case 'period_quota':
        schedule = {
          kind: 'period_quota',
          period: quotaPeriod,
          quota: quotaValue ?? 1,
          weekStartsOn: 1,
          startDate,
          slots,
        };
        break;
      case 'once':
      case 'daily':
        schedule = { kind: 'daily', startDate, slots };
        break;
    }
    return { schedule, reminders: activeReminders };
  };

  const save = () => {
    setSubmitted(true);
    const firstError = validationMessages[0];
    if (firstError) {
      Alert.alert('Revisa el formulario', firstError);
      return;
    }
    const recurrence = buildSchedule();
    const common = {
      title: title.trim(),
      notes: notes.trim(),
      category: category.trim(),
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      ...recurrence,
    };

    if (kind === 'habit') {
      commit({
        ...common,
        kind,
        metric,
        target:
          metric === 'boolean'
            ? 1
            : metric === 'duration'
              ? targetValue! * 60
              : targetValue!,
        unit: metric === 'duration' ? 'segundos' : unit.trim() || 'veces',
        graceMinutes: graceMinutesValue!,
      });
    } else if (kind === 'task') {
      commit({
        ...common,
        kind,
        priority,
        dueAt: `${normalizedDueDate!} · ${normalizedDueTime!}`,
        deadlineAt: normalizedDeadline ?? undefined,
        recurring,
        subtasks: subtasks
          .filter((line) => line.title.trim())
          .map((line) => ({
            id: line.id,
            title: line.title.trim(),
            required: line.required,
          })),
      });
    } else {
      commit({
        ...common,
        kind,
        steps: steps
          .filter((line) => line.title.trim())
          .map((line) => ({
            id: line.id,
            title: line.title.trim(),
            required: line.required,
            durationSeconds: line.minutes
              ? Math.max(0, Number(line.minutes) || 0) * 60
              : undefined,
          })),
      });
    }
    router.back();
  };

  const confirmDelete = () => {
    if (!existing) return;
    Alert.alert(
      `Eliminar “${existing.title}”`,
      'Se eliminarán también su historial, recordatorios y configuración. Esta acción se sincronizará con tus otros dispositivos.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            deleteItem(existing.id);
            router.back();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View
          style={[styles.header, { borderBottomColor: theme.colors.border }]}
        >
          <IconButton
            accessibilityLabel="Cerrar"
            icon={ChevronLeft}
            onPress={() => router.back()}
            variant="ghost"
          />
          <View style={styles.headerCopy}>
            <Text align="center" variant="subheading">
              {existing ? 'Editar punto' : 'Nuevo punto'}
            </Text>
            <Text align="center" tone="muted" variant="caption">
              Se guarda en tu dispositivo
            </Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {!existing ? (
            <View accessibilityRole="radiogroup" style={styles.kindPicker}>
              <ChoiceChip
                icon={CircleDot}
                label="Hábito"
                onPress={() => setKind('habit')}
                selected={kind === 'habit'}
                style={styles.kindChip}
              />
              <ChoiceChip
                icon={CheckCircle2}
                label="Tarea"
                onPress={() => setKind('task')}
                selected={kind === 'task'}
                style={styles.kindChip}
              />
              <ChoiceChip
                icon={Route}
                label="Rutina"
                onPress={() => setKind('routine')}
                selected={kind === 'routine'}
                style={styles.kindChip}
              />
            </View>
          ) : null}

          <View style={styles.formGroup}>
            <Text tone="accent" variant="eyebrow">
              IDENTIDAD
            </Text>
            <FormField
              autoCapitalize="sentences"
              autoFocus
              error={titleError}
              label="Nombre"
              onChangeText={setTitle}
              placeholder={
                kind === 'habit'
                  ? 'Ej. Caminar al mediodía'
                  : kind === 'task'
                    ? 'Ej. Entregar documentación'
                    : 'Ej. Cierre de jornada'
              }
              returnKeyType="next"
              value={title}
            />
            <View style={styles.twoColumns}>
              <View style={styles.column}>
                <FormField
                  label="Categoría"
                  onChangeText={setCategory}
                  placeholder="Bienestar"
                  value={category}
                />
              </View>
              <View style={styles.column}>
                <FormField
                  autoCapitalize="none"
                  hint="Separa con comas."
                  label="Etiquetas"
                  onChangeText={setTags}
                  placeholder="salud, mañana"
                  value={tags}
                />
              </View>
            </View>
            <FormField
              label="Notas"
              multiline
              onChangeText={setNotes}
              placeholder="Contexto, intención o cualquier detalle útil."
              value={notes}
            />
          </View>

          {kind === 'habit' ? (
            <View style={styles.formGroup}>
              <Text tone="accent" variant="eyebrow">
                MEDIDA
              </Text>
              <View accessibilityRole="radiogroup" style={styles.choices}>
                <ChoiceChip
                  icon={CheckCircle2}
                  label="Sí o no"
                  onPress={() => setMetric('boolean')}
                  selected={metric === 'boolean'}
                />
                <ChoiceChip
                  icon={Hash}
                  label="Cantidad"
                  onPress={() => setMetric('count')}
                  selected={metric === 'count'}
                />
                <ChoiceChip
                  icon={Clock3}
                  label="Duración"
                  onPress={() => setMetric('duration')}
                  selected={metric === 'duration'}
                />
              </View>
              {metric !== 'boolean' ? (
                <View style={styles.twoColumns}>
                  <View style={styles.column}>
                    <FormField
                      error={targetError}
                      keyboardType="decimal-pad"
                      label={
                        metric === 'duration'
                          ? 'Objetivo (minutos)'
                          : 'Objetivo'
                      }
                      onChangeText={setTarget}
                      placeholder={metric === 'duration' ? '20' : '8'}
                      value={target}
                    />
                  </View>
                  {metric === 'count' ? (
                    <View style={styles.column}>
                      <FormField
                        label="Unidad"
                        onChangeText={setUnit}
                        placeholder="vasos"
                        value={unit}
                      />
                    </View>
                  ) : null}
                </View>
              ) : null}
              <FormField
                error={graceMinutesError}
                hint="Durante este margen aún puedes registrarlo sin que el día cuente como perdido."
                keyboardType="number-pad"
                label="Margen de cierre (minutos)"
                onChangeText={setGraceMinutes}
                placeholder="60"
                value={graceMinutes}
              />
            </View>
          ) : null}

          {kind === 'task' ? (
            <View style={styles.formGroup}>
              <Text tone="accent" variant="eyebrow">
                FECHA Y PRIORIDAD
              </Text>
              <View accessibilityRole="radiogroup" style={styles.choices}>
                <ChoiceChip
                  label="Baja"
                  onPress={() => setPriority('low')}
                  selected={priority === 'low'}
                />
                <ChoiceChip
                  label="Media"
                  onPress={() => setPriority('medium')}
                  selected={priority === 'medium'}
                />
                <ChoiceChip
                  label="Alta"
                  onPress={() => setPriority('high')}
                  selected={priority === 'high'}
                />
              </View>
              <View style={styles.twoColumns}>
                <View style={styles.column}>
                  <FormField
                    error={dueDateError}
                    label="Fecha"
                    onChangeText={setDueDate}
                    placeholder="AAAA-MM-DD"
                    value={dueDate}
                  />
                </View>
                <View style={styles.column}>
                  <FormField
                    error={dueTimeError}
                    label="Hora"
                    onChangeText={setDueTime}
                    placeholder="18:30"
                    value={dueTime}
                  />
                </View>
              </View>
              <FormField
                error={deadlineError}
                hint="Opcional. Puede ser distinta de la hora programada."
                label="Fecha límite"
                onChangeText={setDeadline}
                placeholder="AAAA-MM-DD · 20:00"
                value={deadline}
              />
              <SwitchRow
                description="Vuelve a crear la tarea según el patrón elegido."
                icon={Repeat2}
                onValueChange={setRecurring}
                title="Tarea recurrente"
                value={recurring}
              />
            </View>
          ) : null}

          {kind === 'task' ? (
            <DraftLines
              kind="checklist"
              lines={subtasks}
              onChange={setSubtasks}
            />
          ) : null}
          {kind === 'routine' ? (
            <>
              <DraftLines kind="steps" lines={steps} onChange={setSteps} />
              {stepsError ? (
                <Text tone="danger" variant="caption">
                  {stepsError}
                </Text>
              ) : null}
            </>
          ) : null}

          {kind === 'habit' || kind === 'routine' || recurring ? (
            <View style={styles.formGroup}>
              <Text tone="accent" variant="eyebrow">
                REPETICIÓN
              </Text>
              <View accessibilityRole="radiogroup" style={styles.choices}>
                <ChoiceChip
                  label="Diario"
                  onPress={() => setScheduleKind('daily')}
                  selected={scheduleKind === 'daily'}
                />
                <ChoiceChip
                  label="Días"
                  onPress={() => setScheduleKind('weekdays')}
                  selected={scheduleKind === 'weekdays'}
                />
                <ChoiceChip
                  label="Intervalo"
                  onPress={() => setScheduleKind('interval_days')}
                  selected={scheduleKind === 'interval_days'}
                />
                <ChoiceChip
                  label="Cuota"
                  onPress={() => setScheduleKind('period_quota')}
                  selected={scheduleKind === 'period_quota'}
                />
              </View>
              <FormField
                error={scheduleStartError}
                hint="La recurrencia no crea ocurrencias antes de esta fecha."
                label="Empieza el"
                onChangeText={setScheduleStartDate}
                placeholder="AAAA-MM-DD"
                value={scheduleStartDate}
              />
              {scheduleKind === 'weekdays' ? (
                <>
                  <View accessibilityRole="radiogroup" style={styles.choices}>
                    {weekdays.map(({ day, label }) => (
                      <ChoiceChip
                        key={day}
                        label={label}
                        onPress={() =>
                          setScheduleDays((current) =>
                            current.includes(day)
                              ? current.filter((value) => value !== day)
                              : [...current, day].sort(
                                  (left, right) => left - right,
                                ),
                          )
                        }
                        selected={scheduleDays.includes(day)}
                      />
                    ))}
                  </View>
                  {weekdaysError ? (
                    <Text tone="danger" variant="caption">
                      {weekdaysError}
                    </Text>
                  ) : null}
                </>
              ) : null}
              {scheduleKind === 'interval_days' ? (
                <View style={styles.twoColumns}>
                  <View style={styles.column}>
                    <FormField
                      error={intervalEveryError}
                      keyboardType="number-pad"
                      label="Cada cuántos días"
                      onChangeText={setIntervalEvery}
                      placeholder="2"
                      value={intervalEvery}
                    />
                  </View>
                  <View style={styles.column}>
                    <FormField
                      error={intervalAnchorError}
                      label="Fecha de ancla"
                      onChangeText={setIntervalAnchor}
                      placeholder="AAAA-MM-DD"
                      value={intervalAnchor}
                    />
                  </View>
                </View>
              ) : null}
              {scheduleKind === 'period_quota' ? (
                <>
                  <View accessibilityRole="radiogroup" style={styles.choices}>
                    <ChoiceChip
                      label="Por semana"
                      onPress={() => setQuotaPeriod('week')}
                      selected={quotaPeriod === 'week'}
                    />
                    <ChoiceChip
                      label="Por mes"
                      onPress={() => setQuotaPeriod('month')}
                      selected={quotaPeriod === 'month'}
                    />
                  </View>
                  <FormField
                    error={quotaError}
                    hint="Las distintas horas no multiplican esta cuota."
                    keyboardType="number-pad"
                    label="Número de veces"
                    onChangeText={setQuota}
                    placeholder="3"
                    value={quota}
                  />
                </>
              ) : null}
            </View>
          ) : null}

          <View style={styles.formGroup}>
            <Text tone="accent" variant="eyebrow">
              RECORDATORIOS Y FRANJAS
            </Text>
            <SwitchRow
              description="Podrás completar o posponer sin abrir Atlas."
              icon={Bell}
              onValueChange={setReminderEnabled}
              title="Avisarme"
              value={reminderEnabled}
            />
            {reminderEnabled ? (
              <>
                <ReminderLines
                  reminders={reminders}
                  timeErrors={reminderTimeErrors}
                  onChange={setReminders}
                />
                {submitted && reminders.length === 0 ? (
                  <Text tone="danger" variant="caption">
                    Añade al menos una hora o desactiva «Avisarme».
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
          <View style={styles.scrollBottom} />
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              backgroundColor: theme.colors.background,
              borderTopColor: theme.colors.border,
            },
          ]}
        >
          <Button fullWidth label={submitLabel} onPress={save} size="lg" />
          {existing ? (
            <Button
              fullWidth
              label="Eliminar este elemento"
              leadingIcon={Trash2}
              onPress={confirmDelete}
              variant="danger"
            />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 68,
    paddingHorizontal: 12,
  },
  headerCopy: { flex: 1, gap: 1 },
  headerSpacer: { width: 48 },
  scrollContent: { gap: 28, paddingHorizontal: 16, paddingTop: 18 },
  kindPicker: { flexDirection: 'row', gap: 8 },
  kindChip: { flex: 1, paddingHorizontal: 8 },
  formGroup: { gap: 14 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  twoColumns: { flexDirection: 'row', gap: 12 },
  column: { flex: 1, minWidth: 0 },
  switchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 64,
  },
  switchIcon: {
    alignItems: 'center',
    borderRadius: 12,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  switchCopy: { flex: 1, gap: 2 },
  fieldHeading: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  fieldHeadingCopy: { flex: 1, gap: 2 },
  lineCard: { gap: 10 },
  lineTop: { alignItems: 'flex-start', flexDirection: 'row', gap: 9 },
  lineIndex: {
    alignItems: 'center',
    borderRadius: 12,
    height: 32,
    justifyContent: 'center',
    marginTop: 28,
    width: 32,
  },
  lineInputWrap: { flex: 1 },
  lineOptions: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingLeft: 41,
  },
  durationField: { minWidth: 130 },
  reminderCard: { gap: 8 },
  reminderDelete: { marginTop: 28 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  scrollBottom: { height: 18 },
});
