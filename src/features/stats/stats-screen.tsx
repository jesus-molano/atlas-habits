import { Award, CalendarCheck, Flame, Route, Timer } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Card, Screen, Text } from '@/components/core';
import { useTheme } from '@/design';
import { useAtlasApp, type HistoryDay } from '@/features/atlas';
import { PageHeader } from '@/features/ui';

import { globalStreaks } from './stats-metrics';

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function recentDays(history: readonly HistoryDay[]): HistoryDay[] {
  const byDate = new Map(history.map((day) => [day.date, day]));
  return Array.from({ length: 35 }, (_, index) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (34 - index));
    const key = dateKey(date);
    return byDate.get(key) ?? { date: key, ratio: 0, focusSeconds: 0 };
  });
}

function calendarHeatmapDays(history: readonly HistoryDay[]): HistoryDay[] {
  const byDate = new Map(history.map((day) => [day.date, day]));
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const isoWeekday = today.getDay() === 0 ? 7 : today.getDay();
  const endOfWeek = new Date(today);
  endOfWeek.setDate(today.getDate() + (7 - isoWeekday));
  const start = new Date(endOfWeek);
  start.setDate(endOfWeek.getDate() - 34);
  return Array.from({ length: 35 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dateKey(date);
    return byDate.get(key) ?? { date: key, ratio: 0, focusSeconds: 0 };
  });
}

function weekday(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('es-ES', {
    weekday: 'narrow',
  });
}

function focusLabel(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`;
}

export function StatsScreen() {
  const theme = useTheme();
  const { hydrated, snapshot, progress } = useAtlasApp();
  const recent = recentDays(snapshot.history);
  const heatmap = calendarHeatmapDays(snapshot.history);
  const weeks = Array.from({ length: 5 }, (_, index) =>
    heatmap.slice(index * 7, index * 7 + 7),
  );
  const week = recent.slice(-7);
  const today = dateKey(new Date());
  const stats = globalStreaks(recent);
  const weeklyRatio =
    week.reduce((sum, day) => sum + day.ratio, 0) / week.length;
  const weeklyFocus = week.reduce((sum, day) => sum + day.focusSeconds, 0);
  const bestHabit = [...snapshot.habits].sort((a, b) => b.streak - a.streak)[0];
  const cellColor = (ratio: number) => {
    if (ratio <= 0) return theme.colors.surfaceMuted;
    if (ratio < 0.34) return theme.colors.textMuted;
    if (ratio < 0.67) return theme.colors.accent;
    if (ratio < 0.999) return theme.colors.primary;
    return theme.colors.success;
  };

  if (!hydrated) {
    return (
      <Screen
        contentContainerStyle={styles.content}
        safeAreaEdges={['top', 'left', 'right']}
        scroll
      >
        <PageHeader
          description="Constancia y tiempo, sin mezclar métricas."
          eyebrow="Bitácora"
          title="Progreso"
        />
        <View
          accessibilityLabel="Cargando progreso"
          accessibilityLiveRegion="polite"
          accessibilityRole="progressbar"
          style={styles.loading}
        >
          <ActivityIndicator color={theme.colors.primary} size="large" />
          <Text tone="secondary">Preparando tu progreso…</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      contentContainerStyle={styles.content}
      safeAreaEdges={['top', 'left', 'right']}
      scroll
    >
      <PageHeader
        description="Constancia y tiempo, sin mezclar métricas."
        eyebrow="Bitácora"
        title="Progreso"
      />

      <Card padding="md" style={styles.weekCard} variant="raised">
        <View style={styles.weekPercent}>
          <Text color="primary" variant="metric">
            {Math.round(weeklyRatio * 100)}%
          </Text>
          <Text tone="muted" variant="caption">
            7 días
          </Text>
        </View>
        <View style={styles.weekCopy}>
          <Text variant="subheading">Constancia semanal</Text>
          <Text tone="secondary" variant="caption">
            {weeklyRatio > 0
              ? 'La constancia cuenta acciones completadas.'
              : 'Completa una acción para iniciar el mapa.'}
          </Text>
        </View>
      </Card>

      <View style={styles.metrics}>
        <Card padding="sm" style={styles.metricCard}>
          <Flame color={theme.colors.primary} size={20} />
          <Text variant="metric">{stats.current}</Text>
          <Text tone="secondary" variant="caption">
            Racha actual
          </Text>
        </Card>
        <Card padding="sm" style={styles.metricCard}>
          <Award color={theme.colors.accent} size={20} />
          <Text variant="metric">
            {Math.max(stats.best, bestHabit?.streak ?? 0)}
          </Text>
          <Text tone="secondary" variant="caption">
            Mejor racha
          </Text>
        </Card>
        <Card padding="sm" style={styles.metricCard}>
          <Timer color={theme.colors.info} size={20} />
          <Text variant="bodyStrong">{focusLabel(weeklyFocus)}</Text>
          <Text tone="secondary" variant="caption">
            Foco semanal
          </Text>
        </Card>
        <Card padding="sm" style={styles.metricCard}>
          <CalendarCheck color={theme.colors.success} size={20} />
          <Text variant="metric">{progress.completed}</Text>
          <Text tone="secondary" variant="caption">
            Hoy
          </Text>
        </Card>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <Route color={theme.colors.primary} size={20} />
          <View style={styles.headingCopy}>
            <Text variant="subheading">Mapa de constancia</Text>
            <Text
              accessibilityLabel={`Mapa de 35 días. ${heatmap.filter((day) => day.ratio >= 0.999).length} días completos.`}
              tone="secondary"
              variant="caption"
            >
              5 semanas · cada celda es un día
            </Text>
          </View>
        </View>
        <Card padding="md" variant="outlined">
          <View style={styles.heatmapRow}>
            <View style={styles.weekdayLabels}>
              {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((label) => (
                <Text key={label} tone="muted" variant="caption">
                  {label}
                </Text>
              ))}
            </View>
            {weeks.map((days, weekIndex) => (
              <View key={days[0]?.date ?? weekIndex} style={styles.heatmapWeek}>
                {days.map((day) => (
                  <View
                    accessible
                    accessibilityLabel={
                      day.date > today
                        ? `${new Date(`${day.date}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}: fecha futura`
                        : `${new Date(`${day.date}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}: ${Math.round(day.ratio * 100)} por ciento`
                    }
                    key={day.date}
                    style={[
                      styles.heatCell,
                      {
                        backgroundColor: cellColor(day.ratio),
                        borderColor:
                          day.ratio === 0
                            ? theme.colors.borderStrong
                            : cellColor(day.ratio),
                        opacity: day.date > today ? 0.45 : 1,
                      },
                    ]}
                  />
                ))}
              </View>
            ))}
          </View>
          <View style={styles.legend}>
            <Text tone="muted" variant="caption">
              0%
            </Text>
            {[0, 0.2, 0.5, 0.8, 1].map((ratio) => (
              <View
                key={ratio}
                style={[
                  styles.legendCell,
                  {
                    backgroundColor: cellColor(ratio),
                    borderColor:
                      ratio === 0
                        ? theme.colors.borderStrong
                        : cellColor(ratio),
                  },
                ]}
              />
            ))}
            <Text tone="muted" variant="caption">
              100%
            </Text>
          </View>
        </Card>
      </View>

      <View style={styles.section}>
        <Text variant="subheading">Última semana</Text>
        <Card padding="md" style={styles.bars}>
          {week.map((day) => (
            <View
              accessibilityLabel={`${day.date}: ${Math.round(day.ratio * 100)} por ciento`}
              key={day.date}
              style={styles.barColumn}
            >
              <Text tone="muted" variant="caption">
                {Math.round(day.ratio * 100)}
              </Text>
              <View
                style={[
                  styles.barTrack,
                  { backgroundColor: theme.colors.track },
                ]}
              >
                <View
                  style={[
                    styles.barFill,
                    {
                      backgroundColor: theme.colors.primary,
                      height:
                        day.ratio === 0
                          ? 0
                          : `${Math.max(8, day.ratio * 100)}%`,
                    },
                  ]}
                />
              </View>
              <Text variant="caption">{weekday(day.date)}</Text>
            </View>
          ))}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 18, paddingBottom: 148, paddingTop: 8 },
  loading: {
    alignItems: 'center',
    flex: 1,
    gap: 14,
    justifyContent: 'center',
    minHeight: 320,
  },
  weekCard: { alignItems: 'center', flexDirection: 'row', gap: 14 },
  weekPercent: { alignItems: 'center', minWidth: 72 },
  weekCopy: { flex: 1, gap: 2 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricCard: { flexBasis: '47%', flexGrow: 1, gap: 2, minHeight: 105 },
  section: { gap: 10 },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  headingCopy: { flex: 1, gap: 1 },
  heatmapRow: { flexDirection: 'row', gap: 7, justifyContent: 'center' },
  weekdayLabels: { gap: 6, justifyContent: 'space-around', paddingVertical: 1 },
  heatmapWeek: { gap: 6 },
  heatCell: { borderRadius: 6, borderWidth: 1.5, height: 28, width: 28 },
  legend: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: 14,
  },
  legendCell: { borderRadius: 4, borderWidth: 1, height: 15, width: 15 },
  bars: { alignItems: 'flex-end', flexDirection: 'row', gap: 7, height: 170 },
  barColumn: {
    alignItems: 'center',
    flex: 1,
    gap: 5,
    height: '100%',
    justifyContent: 'flex-end',
  },
  barTrack: {
    borderRadius: 999,
    flex: 1,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    width: 14,
  },
  barFill: { borderRadius: 999, width: '100%' },
});
