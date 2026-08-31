import type { AtlasSnapshot, HistoryDay } from './types';

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function historySeed(): HistoryDay[] {
  return Array.from({ length: 35 }, (_, index) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (34 - index));
    const cycle = [0.75, 1, 0.5, 0.9, 0.35, 1, 0.65];
    return { date: isoDate(date), ratio: cycle[index % cycle.length] ?? 0 };
  });
}

/**
 * Starter content used only for a brand-new local profile or if no external
 * service is injected. Every interaction is persisted by the default adapter.
 */
export function createFallbackSnapshot(): AtlasSnapshot {
  const today = isoDate(new Date());
  return {
    schemaVersion: 1,
    source: 'fallback_seed',
    dashboardOrder: ['routines', 'habits', 'tasks'],
    habitHistory: {},
    sync: { status: 'local-only' },
    history: historySeed(),
    habits: [
      {
        id: 'starter-water',
        kind: 'habit',
        title: 'Beber agua',
        notes: 'Vaso a vaso. El objetivo se acumula durante el día.',
        category: 'Bienestar',
        tags: ['salud'],
        schedule: { kind: 'daily', startDate: today, slots: [] },
        reminders: [
          {
            id: 'starter-reminder-water',
            time: '10:00',
            enabled: true,
            snoozeMinutes: 10,
          },
        ],
        scheduleLabel: 'Todos los días',
        reminderTime: '10:00',
        sortOrder: 0,
        metric: 'count',
        target: 8,
        unit: 'vasos',
        value: 5,
        completed: false,
        graceMinutes: 120,
        streak: 12,
      },
      {
        id: 'starter-read',
        kind: 'habit',
        title: 'Leer 20 minutos',
        category: 'Aprendizaje',
        tags: ['lectura'],
        schedule: {
          kind: 'weekdays',
          days: [1, 2, 3, 4, 5],
          startDate: today,
          slots: [],
        },
        reminders: [
          {
            id: 'starter-reminder-read',
            time: '21:30',
            enabled: true,
            snoozeMinutes: 10,
          },
        ],
        scheduleLabel: 'Lun, mar, mié, jue y vie',
        reminderTime: '21:30',
        sortOrder: 1,
        metric: 'duration',
        target: 1_200,
        unit: 'min',
        value: 0,
        completed: false,
        graceMinutes: 60,
        streak: 6,
      },
      {
        id: 'starter-vitamins',
        kind: 'habit',
        title: 'Tomar vitaminas',
        category: 'Salud',
        tags: [],
        schedule: { kind: 'daily', startDate: today, slots: [] },
        reminders: [
          {
            id: 'starter-reminder-vitamins',
            time: '08:30',
            enabled: true,
            snoozeMinutes: 10,
          },
        ],
        scheduleLabel: 'Todos los días',
        reminderTime: '08:30',
        sortOrder: 2,
        metric: 'boolean',
        target: 1,
        unit: 'vez',
        value: 1,
        completed: true,
        graceMinutes: 30,
        streak: 21,
      },
    ],
    tasks: [
      {
        id: 'starter-task-shopping',
        kind: 'task',
        title: 'Preparar compra semanal',
        notes: 'Revisar primero la despensa.',
        category: 'Casa',
        tags: ['recados'],
        schedule: { kind: 'once', date: today, startDate: today, slots: [] },
        reminders: [],
        scheduleLabel: 'Hoy',
        dueAt: '18:30',
        deadlineAt: '20:00',
        priority: 'medium',
        recurring: false,
        completed: false,
        sortOrder: 0,
        subtasks: [
          {
            id: 'starter-subtask-1',
            title: 'Revisar despensa',
            completed: true,
            required: true,
          },
          {
            id: 'starter-subtask-2',
            title: 'Crear lista',
            completed: false,
            required: true,
          },
        ],
      },
      {
        id: 'starter-task-call',
        kind: 'task',
        title: 'Llamar a la clínica',
        category: 'Personal',
        tags: [],
        schedule: { kind: 'once', date: today, startDate: today, slots: [] },
        reminders: [],
        scheduleLabel: 'Hoy',
        dueAt: '13:00',
        priority: 'high',
        recurring: false,
        completed: false,
        sortOrder: 1,
        subtasks: [],
      },
    ],
    routines: [
      {
        id: 'starter-routine-morning',
        kind: 'routine',
        title: 'Despegue de mañana',
        notes: 'Una salida corta y sin distracciones.',
        category: 'Rutinas',
        tags: ['mañana'],
        schedule: { kind: 'daily', startDate: today, slots: [] },
        reminders: [
          {
            id: 'starter-reminder-routine',
            time: '07:30',
            enabled: true,
            snoozeMinutes: 10,
          },
        ],
        scheduleLabel: 'Todos los días · 07:30',
        reminderTime: '07:30',
        sortOrder: 0,
        completed: false,
        running: false,
        steps: [
          {
            id: 'starter-step-1',
            title: 'Abrir persianas y ventilar',
            required: true,
            completed: true,
          },
          {
            id: 'starter-step-2',
            title: 'Movilidad suave',
            required: true,
            durationSeconds: 300,
            completed: false,
          },
          {
            id: 'starter-step-3',
            title: 'Preparar el día',
            required: true,
            durationSeconds: 180,
            completed: false,
          },
          {
            id: 'starter-step-4',
            title: 'Elegir una canción',
            required: false,
            completed: false,
          },
        ],
      },
    ],
  };
}
