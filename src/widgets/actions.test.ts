import { describe, expect, it } from 'vitest';

import { WIDGET_ACTIONS, widgetClickToCommand } from './actions';

describe('widget actions', () => {
  const now = new Date('2026-08-31T12:00:00.000Z');

  it('maps a valid click to the shared completion command', () => {
    const envelope = widgetClickToCommand(
      WIDGET_ACTIONS.complete,
      {
        targetKind: 'habit',
        targetId: 'habit-1',
        occurrenceId: 'occurrence-1',
      },
      now,
    );

    expect(envelope).toMatchObject({
      source: 'widget',
      command: {
        type: 'occurrence.complete',
        completed: true,
        targetId: 'habit-1',
      },
    });
  });

  it('ignores malformed and unrelated clicks', () => {
    expect(widgetClickToCommand('OPEN_APP', {}, now)).toBeNull();
    expect(
      widgetClickToCommand(
        WIDGET_ACTIONS.complete,
        { targetKind: 'habit', targetId: '' },
        now,
      ),
    ).toBeNull();
  });
});
