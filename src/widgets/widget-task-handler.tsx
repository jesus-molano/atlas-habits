import {
  registerWidgetTaskHandler,
  type WidgetTaskHandler,
} from 'react-native-android-widget';

import type { CommandGateway } from '../platform/commands';

import { widgetClickToCommand } from './actions';
import { isAtlasWidgetName, type AtlasWidgetDataSource } from './model';
import { renderAtlasWidget } from './render';

export interface AtlasWidgetTaskDependencies {
  readonly commandGateway: CommandGateway;
  readonly dataSource: AtlasWidgetDataSource;
  readonly now?: () => Date;
  readonly reportError?: (error: unknown) => void;
}

export function createAtlasWidgetTaskHandler(
  dependencies: AtlasWidgetTaskDependencies,
): WidgetTaskHandler {
  const now = dependencies.now ?? (() => new Date());

  return async (props) => {
    const { widgetName, widgetId } = props.widgetInfo;

    if (!isAtlasWidgetName(widgetName)) {
      return;
    }

    try {
      if (props.widgetAction === 'WIDGET_DELETED') {
        await dependencies.dataSource.onWidgetDeleted?.(widgetName, widgetId);
        return;
      }

      if (props.widgetAction === 'WIDGET_CLICK') {
        const envelope = widgetClickToCommand(
          props.clickAction,
          props.clickActionData,
          now(),
        );

        if (envelope) {
          await dependencies.commandGateway.dispatch(envelope);
        }
      }

      const snapshot = await dependencies.dataSource.getSnapshot(
        widgetName,
        props.widgetInfo,
      );
      props.renderWidget(renderAtlasWidget(widgetName, snapshot));
    } catch (error) {
      dependencies.reportError?.(error);
      throw error;
    }
  };
}

let isRegistered = false;

/** Call once in the application entry module so Android can start it headlessly. */
export function registerAtlasWidgetTaskHandler(
  dependencies: AtlasWidgetTaskDependencies,
): void {
  if (isRegistered) {
    return;
  }

  registerWidgetTaskHandler(createAtlasWidgetTaskHandler(dependencies));
  isRegistered = true;
}
