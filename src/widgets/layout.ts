import type { WidgetInfo } from 'react-native-android-widget';

import type { AtlasWidgetName } from './model';

export type AtlasWidgetLayout = Readonly<{
  compact: boolean;
  ultraCompact: boolean;
  padding: number;
  titleFontSize: number;
  bodyFontSize: number;
  maxHabitRows: number;
  maxTaskRows: number;
  showStreak: boolean;
}>;

type WidgetBounds = Pick<WidgetInfo, 'height' | 'width'>;

const fallbackBounds: WidgetBounds = { width: 250, height: 110 };

function dimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Adapt density to the current homescreen allocation, expressed in dp. */
export function atlasWidgetLayout(
  widgetName: AtlasWidgetName,
  bounds?: WidgetBounds,
): AtlasWidgetLayout {
  const width = dimension(bounds?.width ?? 0, fallbackBounds.width);
  const height = dimension(bounds?.height ?? 0, fallbackBounds.height);
  const ultraCompact = height < 76;
  const compact = width < 250 || height < 128;
  const padding = ultraCompact ? 8 : compact ? 12 : 16;
  const rowHeight = width < 250 ? 36 : 40;
  const habitSpace = Math.max(0, height - padding * 2 - 28);
  const maxHabitRows = Math.max(
    1,
    Math.min(4, Math.floor(habitSpace / rowHeight)),
  );
  const maxTaskRows = height >= 170 ? 3 : height >= 132 ? 2 : 1;

  return {
    compact,
    ultraCompact,
    padding,
    titleFontSize: compact ? 10 : 11,
    bodyFontSize: compact ? 13 : 14,
    maxHabitRows: widgetName === 'AtlasHabitsWidget' ? maxHabitRows : 0,
    maxTaskRows: widgetName === 'AtlasTasksWidget' ? maxTaskRows : 0,
    showStreak:
      widgetName === 'AtlasProgressWidget' && width >= 230 && height >= 104,
  };
}
