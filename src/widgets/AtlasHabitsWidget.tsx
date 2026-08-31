import { FlexWidget, TextWidget } from 'react-native-android-widget';

import { createWidgetCompletionActionData, WIDGET_ACTIONS } from './actions';
import type { AtlasWidgetSnapshot, WidgetCompletableItem } from './model';
import type { AtlasWidgetPalette } from './theme';
import { widgetFonts } from './theme';

export interface AtlasHabitsWidgetProps {
  readonly snapshot: AtlasWidgetSnapshot;
  readonly palette: AtlasWidgetPalette;
}

export function AtlasHabitsWidget({
  snapshot,
  palette,
}: AtlasHabitsWidgetProps) {
  const habits = snapshot.habits.slice(0, 4);

  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        height: 'match_parent',
        padding: 16,
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
            fontSize: 11,
            letterSpacing: 1.2,
          }}
        />
        <TextWidget
          text={`${snapshot.progress.completed}/${snapshot.progress.total}`}
          style={{
            color: palette.accent,
            fontFamily: widgetFonts.bold,
            fontSize: 14,
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
          <HabitRow key={habit.occurrenceId} habit={habit} palette={palette} />
        ))
      )}
    </FlexWidget>
  );
}

function HabitRow({
  habit,
  palette,
}: {
  readonly habit: WidgetCompletableItem;
  readonly palette: AtlasWidgetPalette;
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
        paddingHorizontal: 12,
        paddingVertical: 9,
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
          fontSize: 20,
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
            fontSize: 14,
          }}
        />
      </FlexWidget>
    </FlexWidget>
  );
}
