import { requestWidgetUpdate } from 'react-native-android-widget';

import {
  ATLAS_WIDGET_NAMES,
  type AtlasWidgetDataSource,
  type AtlasWidgetName,
} from './model';
import { renderAtlasWidget } from './render';

export async function refreshAtlasWidgetsAsync(
  dataSource: AtlasWidgetDataSource,
): Promise<void> {
  await Promise.all(
    Object.values(ATLAS_WIDGET_NAMES).map((widgetName) =>
      refreshAtlasWidgetAsync(widgetName, dataSource),
    ),
  );
}

export async function refreshAtlasWidgetAsync(
  widgetName: AtlasWidgetName,
  dataSource: AtlasWidgetDataSource,
): Promise<void> {
  await requestWidgetUpdate({
    widgetName,
    renderWidget: async (widgetInfo) =>
      renderAtlasWidget(
        widgetName,
        await dataSource.getSnapshot(widgetName, widgetInfo),
      ),
  });
}
