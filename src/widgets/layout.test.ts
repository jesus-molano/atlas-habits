import { describe, expect, it } from 'vitest';

import { atlasWidgetLayout } from './layout';

describe('Android widget layouts', () => {
  it('keeps progress and tasks useful at their compact footprint', () => {
    expect(
      atlasWidgetLayout('AtlasProgressWidget', { width: 180, height: 110 }),
    ).toMatchObject({ compact: true, padding: 12, showStreak: false });
    expect(
      atlasWidgetLayout('AtlasTasksWidget', { width: 180, height: 110 }),
    ).toMatchObject({ compact: true, maxTaskRows: 1 });
  });

  it('uses a single-line layout at the launcher minimum height', () => {
    expect(
      atlasWidgetLayout('AtlasProgressWidget', { width: 180, height: 48 }),
    ).toMatchObject({ ultraCompact: true, padding: 8, showStreak: false });
    expect(
      atlasWidgetLayout('AtlasHabitsWidget', { width: 180, height: 48 }),
    ).toMatchObject({ ultraCompact: true, maxHabitRows: 1 });
    expect(
      atlasWidgetLayout('AtlasTasksWidget', { width: 180, height: 48 }),
    ).toMatchObject({ ultraCompact: true, maxTaskRows: 1 });
  });

  it('recovers the detailed layout when the widget grows', () => {
    expect(
      atlasWidgetLayout('AtlasProgressWidget', { width: 180, height: 110 })
        .ultraCompact,
    ).toBe(false);
  });

  it('adds task rows only when the user increases height', () => {
    expect(
      atlasWidgetLayout('AtlasTasksWidget', { width: 250, height: 132 })
        .maxTaskRows,
    ).toBe(2);
    expect(
      atlasWidgetLayout('AtlasTasksWidget', { width: 250, height: 170 })
        .maxTaskRows,
    ).toBe(3);
  });

  it('adapts habit rows to width and height', () => {
    expect(
      atlasWidgetLayout('AtlasHabitsWidget', { width: 180, height: 110 })
        .maxHabitRows,
    ).toBe(1);
    expect(
      atlasWidgetLayout('AtlasHabitsWidget', { width: 220, height: 180 })
        .maxHabitRows,
    ).toBe(3);
    expect(
      atlasWidgetLayout('AtlasHabitsWidget', { width: 300, height: 260 })
        .maxHabitRows,
    ).toBe(4);
  });

  it('uses safe defaults while Android reports zero bounds', () => {
    expect(
      atlasWidgetLayout('AtlasProgressWidget', { width: 0, height: 0 }),
    ).toMatchObject({ compact: true, showStreak: true });
  });
});
