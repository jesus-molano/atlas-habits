import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const WIDGET_COMPONENTS = [
  'AtlasProgressWidget.tsx',
  'AtlasHabitsWidget.tsx',
  'AtlasTasksWidget.tsx',
] as const;

describe('Android widget compiler boundary', () => {
  it.each(WIDGET_COMPONENTS)(
    'keeps the React Compiler disabled at the start of %s',
    (filename) => {
      const source = readFileSync(new URL(filename, import.meta.url), 'utf8');

      expect(source).toMatch(/^["']use no memo["'];\r?\n/);
    },
  );
});
