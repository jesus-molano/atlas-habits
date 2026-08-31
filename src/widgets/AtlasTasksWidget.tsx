import { FlexWidget, TextWidget } from 'react-native-android-widget';

import type { AtlasWidgetSnapshot, WidgetUpcomingTask } from './model';
import type { AtlasWidgetPalette } from './theme';
import { widgetFonts } from './theme';

export interface AtlasTasksWidgetProps {
  readonly snapshot: AtlasWidgetSnapshot;
  readonly palette: AtlasWidgetPalette;
}

export function AtlasTasksWidget({ snapshot, palette }: AtlasTasksWidgetProps) {
  const tasks = snapshot.upcomingTasks.slice(0, 3);

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel="Abrir próximas tareas en Atlas"
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
      <TextWidget
        text="PRÓXIMAS"
        style={{
          color: palette.muted,
          fontFamily: widgetFonts.bold,
          fontSize: 11,
          letterSpacing: 1.2,
        }}
      />

      {tasks.length === 0 ? (
        <TextWidget
          text="Todo despejado"
          style={{
            color: palette.text,
            fontFamily: widgetFonts.bold,
            fontSize: 17,
            marginTop: 10,
          }}
        />
      ) : (
        tasks.map((task) => (
          <TaskRow key={task.id} task={task} palette={palette} />
        ))
      )}
    </FlexWidget>
  );
}

function TaskRow({
  task,
  palette,
}: {
  readonly task: WidgetUpcomingTask;
  readonly palette: AtlasWidgetPalette;
}) {
  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
        flexGap: 9,
      }}
    >
      <FlexWidget
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor:
            task.priority === 'high' ? palette.accent : palette.muted,
        }}
      />
      <FlexWidget style={{ flex: 1 }}>
        <TextWidget
          text={task.title}
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
        text={task.dueLabel}
        maxLines={1}
        style={{
          color: task.priority === 'high' ? palette.accent : palette.muted,
          fontFamily: widgetFonts.bold,
          fontSize: 12,
        }}
      />
    </FlexWidget>
  );
}
