import { describe, expect, it, vi } from 'vitest';

import { ATLAS_WIDGET_NAMES, type AtlasWidgetDataSource } from './model';
import { refreshAtlasWidgetsAsync } from './refresh';

const native = vi.hoisted(() => ({ requestWidgetUpdate: vi.fn() }));

vi.mock('react-native-android-widget', () => ({
  requestWidgetUpdate: native.requestWidgetUpdate,
}));

vi.mock('./render', () => ({ renderAtlasWidget: vi.fn() }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('refreshAtlasWidgetsAsync', () => {
  it('starts widget-type update requests in a stable sequence', async () => {
    const first = deferred();
    native.requestWidgetUpdate.mockImplementationOnce(() => first.promise);
    native.requestWidgetUpdate.mockResolvedValue(undefined);
    const dataSource = {} as AtlasWidgetDataSource;

    const refresh = refreshAtlasWidgetsAsync(dataSource);

    await vi.waitFor(() => {
      expect(native.requestWidgetUpdate).toHaveBeenCalledTimes(1);
    });
    expect(native.requestWidgetUpdate.mock.calls[0]?.[0]).toMatchObject({
      widgetName: ATLAS_WIDGET_NAMES.progress,
    });

    first.resolve();
    await refresh;

    expect(native.requestWidgetUpdate).toHaveBeenCalledTimes(3);
    expect(
      native.requestWidgetUpdate.mock.calls.map(
        ([request]) => request.widgetName,
      ),
    ).toEqual([
      ATLAS_WIDGET_NAMES.progress,
      ATLAS_WIDGET_NAMES.habits,
      ATLAS_WIDGET_NAMES.tasks,
    ]);
  });
});
