import type { WidgetRepresentation } from 'react-native-android-widget';

import { AtlasHabitsWidget } from './AtlasHabitsWidget';
import { AtlasProgressWidget } from './AtlasProgressWidget';
import { AtlasTasksWidget } from './AtlasTasksWidget';
import {
  ATLAS_WIDGET_NAMES,
  type AtlasWidgetName,
  type AtlasWidgetSnapshot,
} from './model';
import { atlasWidgetPalettes } from './theme';

export function renderAtlasWidget(
  widgetName: AtlasWidgetName,
  snapshot: AtlasWidgetSnapshot,
): WidgetRepresentation {
  return {
    light: renderWithPalette(widgetName, snapshot, 'light'),
    dark: renderWithPalette(widgetName, snapshot, 'dark'),
  };
}

function renderWithPalette(
  widgetName: AtlasWidgetName,
  snapshot: AtlasWidgetSnapshot,
  mode: keyof typeof atlasWidgetPalettes,
) {
  const palette = atlasWidgetPalettes[mode];

  switch (widgetName) {
    case ATLAS_WIDGET_NAMES.progress:
      return <AtlasProgressWidget snapshot={snapshot} palette={palette} />;
    case ATLAS_WIDGET_NAMES.habits:
      return <AtlasHabitsWidget snapshot={snapshot} palette={palette} />;
    case ATLAS_WIDGET_NAMES.tasks:
      return <AtlasTasksWidget snapshot={snapshot} palette={palette} />;
  }
}
