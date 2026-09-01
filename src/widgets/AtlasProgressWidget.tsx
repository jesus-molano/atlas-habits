'use no memo';

import { FlexWidget, TextWidget } from 'react-native-android-widget';

import type { AtlasWidgetLayout } from './layout';
import type { AtlasWidgetSnapshot } from './model';
import type { AtlasWidgetPalette } from './theme';
import { widgetFonts } from './theme';

export interface AtlasProgressWidgetProps {
  readonly snapshot: AtlasWidgetSnapshot;
  readonly palette: AtlasWidgetPalette;
  readonly layout: AtlasWidgetLayout;
}

export function AtlasProgressWidget({
  snapshot,
  palette,
  layout,
}: AtlasProgressWidgetProps) {
  const { completed, total, streakDays } = snapshot.progress;
  const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);
  const remaining = Math.max(total - completed, 0);

  if (layout.ultraCompact) {
    return (
      <FlexWidget
        clickAction="OPEN_APP"
        accessibilityLabel={`${completed} de ${total} completados hoy`}
        style={{
          width: 'match_parent',
          height: 'match_parent',
          padding: layout.padding,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: palette.background,
          borderColor: palette.border,
          borderWidth: 1,
          borderRadius: 18,
        }}
      >
        <TextWidget
          text="HOY"
          style={{
            color: palette.muted,
            fontFamily: widgetFonts.bold,
            fontSize: layout.titleFontSize,
            letterSpacing: 1.1,
          }}
        />
        <TextWidget
          text={`${completed}/${total} · ${percentage}%`}
          style={{
            color: palette.text,
            fontFamily: widgetFonts.bold,
            fontSize: 15,
          }}
        />
      </FlexWidget>
    );
  }

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel={`${completed} de ${total} completados hoy`}
      style={{
        width: 'match_parent',
        height: 'match_parent',
        padding: layout.padding,
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: palette.background,
        borderColor: palette.border,
        borderWidth: 1,
        borderRadius: 22,
      }}
    >
      <FlexWidget
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <TextWidget
          text="HOY"
          style={{
            color: palette.muted,
            fontFamily: widgetFonts.bold,
            fontSize: layout.titleFontSize,
            letterSpacing: 1.2,
          }}
        />
        {layout.showStreak ? (
          <TextWidget
            text={
              streakDays > 0 ? `Racha · ${streakDays} d` : 'Empieza tu racha'
            }
            style={{
              color: palette.muted,
              fontFamily: widgetFonts.medium,
              fontSize: layout.compact ? 11 : 12,
            }}
          />
        ) : null}
      </FlexWidget>

      <FlexWidget
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
        }}
      >
        <TextWidget
          text={`${completed}/${total} completados`}
          style={{
            color: palette.text,
            fontFamily: widgetFonts.bold,
            fontSize: layout.compact ? 16 : 18,
          }}
        />
        <TextWidget
          text={`${percentage}%`}
          style={{
            color: palette.accent,
            fontFamily: widgetFonts.bold,
            fontSize: layout.compact ? 20 : 22,
          }}
        />
      </FlexWidget>

      <FlexWidget
        style={{
          width: 'match_parent',
          height: 7,
          flexDirection: 'row',
          backgroundColor: palette.border,
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        {completed > 0 ? (
          <FlexWidget
            style={{
              flex: completed,
              height: 7,
              backgroundColor: palette.accent,
            }}
          />
        ) : null}
        {remaining > 0 ? (
          <FlexWidget style={{ flex: remaining, height: 7 }} />
        ) : null}
      </FlexWidget>
    </FlexWidget>
  );
}
