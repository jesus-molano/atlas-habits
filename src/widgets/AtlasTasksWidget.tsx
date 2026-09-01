'use no memo';

import { FlexWidget, TextWidget } from 'react-native-android-widget';

import type { AtlasWidgetLayout } from './layout';
import type { AtlasWidgetSnapshot, WidgetUpcomingTask } from './model';
import type { AtlasWidgetPalette } from './theme';
import { widgetFonts } from './theme';

export interface AtlasTasksWidgetProps {
  readonly snapshot: AtlasWidgetSnapshot;
  readonly palette: AtlasWidgetPalette;
  readonly layout: AtlasWidgetLayout;
}

export function AtlasTasksWidget({
  snapshot,
  palette,
  layout,
}: AtlasTasksWidgetProps) {
  const tasks = snapshot.upcomingTasks.slice(0, layout.maxTaskRows);

  if (layout.ultraCompact) {
    const task = tasks[0];

    return (
      <FlexWidget
        clickAction="OPEN_APP"
        accessibilityLabel="Abrir próximas tareas en Atlas"
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
          text="PRÓXIMAS"
          style={{
            color: palette.muted,
            fontFamily: widgetFonts.bold,
            fontSize: layout.titleFontSize,
            letterSpacing: 1.1,
          }}
        />
        <FlexWidget style={{ flex: 1 }}>
          <TextWidget
            text={task?.title ?? 'Todo despejado'}
            maxLines={1}
            truncate="END"
            style={{
              color: palette.text,
              fontFamily: widgetFonts.medium,
              fontSize: 14,
            }}
          />
        </FlexWidget>
        {task ? (
          <TextWidget
            text={task.dueLabel}
            maxLines={1}
            style={{
              color: task.priority === 'high' ? palette.accent : palette.muted,
              fontFamily: widgetFonts.bold,
              fontSize: 11,
            }}
          />
        ) : null}
      </FlexWidget>
    );
  }

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel="Abrir próximas tareas en Atlas"
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
      <TextWidget
        text="PRÓXIMAS"
        style={{
          color: palette.muted,
          fontFamily: widgetFonts.bold,
          fontSize: layout.titleFontSize,
          letterSpacing: 1.2,
        }}
      />

      {tasks.length === 0 ? (
        <TextWidget
          text="Todo despejado"
          style={{
            color: palette.text,
            fontFamily: widgetFonts.bold,
            fontSize: layout.compact ? 16 : 17,
            marginTop: 10,
          }}
        />
      ) : (
        tasks.map((task) => (
          <TaskRow
            key={task.id}
            layout={layout}
            task={task}
            palette={palette}
          />
        ))
      )}
    </FlexWidget>
  );
}

function TaskRow({
  task,
  palette,
  layout,
}: {
  readonly task: WidgetUpcomingTask;
  readonly palette: AtlasWidgetPalette;
  readonly layout: AtlasWidgetLayout;
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
            fontSize: layout.bodyFontSize,
          }}
        />
      </FlexWidget>
      <TextWidget
        text={task.dueLabel}
        maxLines={1}
        style={{
          color: task.priority === 'high' ? palette.accent : palette.muted,
          fontFamily: widgetFonts.bold,
          fontSize: layout.compact ? 11 : 12,
        }}
      />
    </FlexWidget>
  );
}
