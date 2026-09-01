'use no memo';

import { FlexWidget, TextWidget } from 'react-native-android-widget';

import { createWidgetCompletionActionData, WIDGET_ACTIONS } from './actions';
import type { AtlasWidgetLayout } from './layout';
import type { AtlasWidgetSnapshot, WidgetCompletableItem } from './model';
import type { AtlasWidgetPalette } from './theme';
import { widgetFonts } from './theme';

export interface AtlasHabitsWidgetProps {
  readonly snapshot: AtlasWidgetSnapshot;
  readonly palette: AtlasWidgetPalette;
  readonly layout: AtlasWidgetLayout;
}

export function AtlasHabitsWidget({
  snapshot,
  palette,
  layout,
}: AtlasHabitsWidgetProps) {
  const habits = snapshot.habits.slice(0, layout.maxHabitRows);

  if (layout.ultraCompact) {
    const habit = habits[0];
    const status = `${snapshot.progress.completed}/${snapshot.progress.total}`;

    return (
      <FlexWidget
        clickAction={
          habit?.completed
            ? 'OPEN_APP'
            : habit
              ? WIDGET_ACTIONS.complete
              : 'OPEN_APP'
        }
        clickActionData={
          habit && !habit.completed
            ? createWidgetCompletionActionData(habit)
            : undefined
        }
        accessibilityLabel={
          habit
            ? habit.completed
              ? `${habit.title}, completado`
              : `Completar ${habit.title}`
            : 'Abrir hábitos en Atlas'
        }
        style={{
          width: 'match_parent',
          height: 'match_parent',
          padding: layout.padding,
          flexDirection: 'row',
          alignItems: 'center',
          flexGap: 8,
          backgroundColor: palette.background,
          borderColor: palette.border,
          borderWidth: 1,
          borderRadius: 18,
        }}
      >
        <TextWidget
          text={habit ? (habit.completed ? '✓' : '○') : 'HÁBITOS'}
          style={{
            color: habit?.completed ? palette.accent : palette.muted,
            fontFamily: widgetFonts.bold,
            fontSize: habit ? 18 : layout.titleFontSize,
            letterSpacing: habit ? 0 : 1.1,
          }}
        />
        <FlexWidget style={{ flex: 1 }}>
          <TextWidget
            text={habit?.title ?? 'No hay hábitos para hoy'}
            maxLines={1}
            truncate="END"
            style={{
              color: palette.text,
              fontFamily: widgetFonts.medium,
              fontSize: 14,
            }}
          />
        </FlexWidget>
        <TextWidget
          text={status}
          style={{
            color: palette.accent,
            fontFamily: widgetFonts.bold,
            fontSize: 12,
          }}
        />
      </FlexWidget>
    );
  }

  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        height: 'match_parent',
        padding: layout.padding,
        flexDirection: 'column',
        flexGap: 8,
        backgroundColor: palette.background,
        borderColor: palette.border,
        borderWidth: 1,
        borderRadius: 22,
      }}
    >
      <FlexWidget
        clickAction="OPEN_APP"
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <TextWidget
          text="HÁBITOS"
          style={{
            color: palette.muted,
            fontFamily: widgetFonts.bold,
            fontSize: layout.titleFontSize,
            letterSpacing: 1.2,
          }}
        />
        <TextWidget
          text={`${snapshot.progress.completed}/${snapshot.progress.total}`}
          style={{
            color: palette.accent,
            fontFamily: widgetFonts.bold,
            fontSize: layout.compact ? 13 : 14,
          }}
        />
      </FlexWidget>

      {habits.length === 0 ? (
        <TextWidget
          text="No hay hábitos para hoy"
          style={{
            color: palette.muted,
            fontFamily: widgetFonts.medium,
            fontSize: 14,
            marginTop: 14,
          }}
        />
      ) : (
        habits.map((habit) => (
          <HabitRow
            key={habit.occurrenceId}
            habit={habit}
            layout={layout}
            palette={palette}
          />
        ))
      )}
    </FlexWidget>
  );
}

function HabitRow({
  habit,
  palette,
  layout,
}: {
  readonly habit: WidgetCompletableItem;
  readonly palette: AtlasWidgetPalette;
  readonly layout: AtlasWidgetLayout;
}) {
  return (
    <FlexWidget
      clickAction={habit.completed ? 'OPEN_APP' : WIDGET_ACTIONS.complete}
      clickActionData={
        habit.completed ? undefined : createWidgetCompletionActionData(habit)
      }
      accessibilityLabel={
        habit.completed
          ? `${habit.title}, completado`
          : `Completar ${habit.title}`
      }
      style={{
        width: 'match_parent',
        paddingHorizontal: layout.compact ? 10 : 12,
        paddingVertical: layout.compact ? 7 : 9,
        flexDirection: 'row',
        alignItems: 'center',
        flexGap: 10,
        backgroundColor: palette.surface,
        borderRadius: 14,
      }}
    >
      <TextWidget
        text={habit.completed ? '✓' : '○'}
        style={{
          color: habit.completed ? palette.accent : palette.muted,
          fontFamily: widgetFonts.bold,
          fontSize: layout.compact ? 18 : 20,
        }}
      />
      <FlexWidget style={{ flex: 1 }}>
        <TextWidget
          text={habit.title}
          maxLines={1}
          truncate="END"
          style={{
            color: habit.completed ? palette.muted : palette.text,
            fontFamily: widgetFonts.medium,
            fontSize: layout.bodyFontSize,
          }}
        />
      </FlexWidget>
    </FlexWidget>
  );
}
