import type { WidgetInfo } from 'react-native-android-widget';

import type { CommandTargetKind } from '../platform/commands';

export const ATLAS_WIDGET_NAMES = {
  progress: 'AtlasProgressWidget',
  habits: 'AtlasHabitsWidget',
  tasks: 'AtlasTasksWidget',
} as const;

export type AtlasWidgetName =
  (typeof ATLAS_WIDGET_NAMES)[keyof typeof ATLAS_WIDGET_NAMES];

export interface WidgetProgress {
  readonly completed: number;
  readonly total: number;
  readonly streakDays: number;
}

export interface WidgetCompletableItem {
  readonly targetKind: CommandTargetKind;
  readonly targetId: string;
  readonly occurrenceId: string;
  readonly title: string;
  readonly completed: boolean;
}

export interface WidgetUpcomingTask {
  readonly id: string;
  readonly title: string;
  /** Preformatted by the application layer for the device locale. */
  readonly dueLabel: string;
  readonly priority?: 'low' | 'medium' | 'high';
}

export interface AtlasWidgetSnapshot {
  readonly generatedAt: string;
  readonly progress: WidgetProgress;
  readonly habits: readonly WidgetCompletableItem[];
  readonly upcomingTasks: readonly WidgetUpcomingTask[];
}

export interface AtlasWidgetDataSource {
  getSnapshot(
    widgetName: AtlasWidgetName,
    widgetInfo: WidgetInfo,
  ): Promise<AtlasWidgetSnapshot>;
  onWidgetDeleted?(
    widgetName: AtlasWidgetName,
    widgetId: number,
  ): Promise<void>;
}

export function isAtlasWidgetName(value: string): value is AtlasWidgetName {
  return (Object.values(ATLAS_WIDGET_NAMES) as readonly string[]).includes(
    value,
  );
}
