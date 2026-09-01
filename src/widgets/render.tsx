import type {
  WidgetInfo,
  WidgetRepresentation,
} from 'react-native-android-widget';

import { AtlasHabitsWidget } from './AtlasHabitsWidget';
import { AtlasProgressWidget } from './AtlasProgressWidget';
import { AtlasTasksWidget } from './AtlasTasksWidget';
import { atlasWidgetLayout } from './layout';
import {
  ATLAS_WIDGET_NAMES,
  type AtlasWidgetName,
  type AtlasWidgetSnapshot,
} from './model';
import { atlasWidgetPalettes } from './theme';

export function renderAtlasWidget(
  widgetName: AtlasWidgetName,
  snapshot: AtlasWidgetSnapshot,
  widgetInfo?: Pick<WidgetInfo, 'height' | 'width'>,
): WidgetRepresentation {
  return {
    light: renderWithPalette(widgetName, snapshot, 'light', widgetInfo),
    dark: renderWithPalette(widgetName, snapshot, 'dark', widgetInfo),
  };
}

function renderWithPalette(
  widgetName: AtlasWidgetName,
  snapshot: AtlasWidgetSnapshot,
  mode: keyof typeof atlasWidgetPalettes,
  widgetInfo?: Pick<WidgetInfo, 'height' | 'width'>,
) {
  const palette = atlasWidgetPalettes[mode];
  const layout = atlasWidgetLayout(widgetName, widgetInfo);

  switch (widgetName) {
    case ATLAS_WIDGET_NAMES.progress:
      return (
        <AtlasProgressWidget
          layout={layout}
          palette={palette}
          snapshot={snapshot}
        />
      );
    case ATLAS_WIDGET_NAMES.habits:
      return (
        <AtlasHabitsWidget
          layout={layout}
          palette={palette}
          snapshot={snapshot}
        />
      );
    case ATLAS_WIDGET_NAMES.tasks:
      return (
        <AtlasTasksWidget
          layout={layout}
          palette={palette}
          snapshot={snapshot}
        />
      );
  }
}
