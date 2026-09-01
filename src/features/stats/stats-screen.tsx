import { Award, CalendarCheck, Flame, Route, Timer } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Card, Screen, Text } from '@/components/core';
import { useTheme } from '@/design';
import { useAtlasApp, type HistoryDay } from '@/features/atlas';
import { PageHeader } from '@/features/ui';

import { globalStreaks, weeklySummary } from './stats-metrics';

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
    return (
      byDate.get(key) ?? {
        date: key,
        eligibleActions: 0,
        ratio: 0,
        focusSeconds: 0,
      }
    );
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
    return (
      byDate.get(key) ?? {
        date: key,
        eligibleActions: 0,
        ratio: 0,
        focusSeconds: 0,
      }
    );
  });
}

function focusMetric(
  seconds: number,
): Readonly<{ unit: string; value: string }> {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return { unit: 'min', value: `${minutes}` };
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return {
    unit: rest > 0 ? `h ${rest} min` : 'h',
    value: `${hours}`,
  };
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
  const weekly = weeklySummary(week);
  const weeklyFocus = week.reduce((sum, day) => sum + day.focusSeconds, 0);
  const focus = focusMetric(weeklyFocus);
  const bestHabit = [...snapshot.habits].sort((a, b) => b.streak - a.streak)[0];
  const completeHeatmapDays = heatmap.filter(
    (day) => day.date <= today && day.ratio >= 0.999,
  ).length;
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
            {weekly.ratio === null ? '—' : `${Math.round(weekly.ratio * 100)}%`}
          </Text>
          <Text tone="muted" variant="caption">
            {weekly.plannedDays}{' '}
            {weekly.plannedDays === 1 ? 'día con plan' : 'días con plan'}
          </Text>
        </View>
        <View style={styles.weekCopy}>
          <Text variant="subheading">Constancia · 7 días</Text>
          <Text tone="secondary" variant="caption">
            {weekly.ratio === null
              ? 'No hubo acciones programadas en este periodo.'
              : 'Los días sin plan no reducen este porcentaje.'}
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
          <View style={styles.metricValue}>
            <Text variant="metric">{focus.value}</Text>
            <Text tone="secondary" variant="label">
              {focus.unit}
            </Text>
          </View>
          <Text tone="secondary" variant="caption">
            Foco · 7 días
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
              accessibilityLabel={`Mapa de 35 días. ${completeHeatmapDays} días completos.`}
              tone="secondary"
              variant="caption"
            >
              5 semanas · {completeHeatmapDays}{' '}
              {completeHeatmapDays === 1 ? 'día completo' : 'días completos'}
            </Text>
          </View>
        </View>
        <Card padding="sm" variant="outlined">
          <View style={styles.heatmapHeader}>
            {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((label) => (
              <Text
                align="center"
                key={label}
                style={styles.heatmapHeaderLabel}
                tone="muted"
                variant="caption"
              >
                {label}
              </Text>
            ))}
          </View>
          <View style={styles.heatmapGrid}>
            {weeks.map((days, weekIndex) => (
              <View key={days[0]?.date ?? weekIndex} style={styles.heatmapWeek}>
                {days.map((day) => (
                  <View key={day.date} style={styles.heatCellSlot}>
                    <View
                      accessible
                      accessibilityLabel={
                        day.date > today
                          ? `${new Date(`${day.date}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}: fecha futura`
                          : day.eligibleActions === 0
                            ? `${new Date(`${day.date}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}: sin acciones programadas`
                            : `${new Date(`${day.date}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}: ${Math.round(day.ratio * 100)} por ciento`
                      }
                      style={[
                        styles.heatCell,
                        {
                          backgroundColor:
                            day.eligibleActions === 0
                              ? theme.colors.surface
                              : cellColor(day.ratio),
                          borderColor:
                            day.ratio === 0
                              ? theme.colors.borderStrong
                              : cellColor(day.ratio),
                          opacity: day.date > today ? 0.38 : 1,
                        },
                      ]}
                    />
                  </View>
                ))}
              </View>
            ))}
          </View>
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View
                style={[
                  styles.legendCell,
                  {
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.borderStrong,
                  },
                ]}
              />
              <Text tone="muted" variant="caption">
                Sin plan
              </Text>
            </View>
            <View style={styles.legendScale}>
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
          </View>
        </Card>
      </View>

      <View style={styles.section}>
        <Text variant="subheading">Balance de 7 días</Text>
        <Card
          accessibilityLabel={`${weekly.completedDays} de ${weekly.plannedDays} días con plan completados. ${weekly.incompleteDays} no completados. ${weekly.neutralDays} sin plan.`}
          padding="md"
          style={styles.balanceCard}
        >
          <View style={styles.balanceLead}>
            <View style={styles.balanceValue}>
              <Text color="primary" variant="metric">
                {weekly.completedDays}
              </Text>
              <Text tone="secondary" variant="subheading">
                de {weekly.plannedDays}
              </Text>
            </View>
            <Text tone="secondary" variant="caption">
              días con plan completados
            </Text>
          </View>
          <View style={styles.balanceRows}>
            {[
              {
                color: theme.colors.success,
                label: 'Completos',
                value: weekly.completedDays,
              },
              {
                color: theme.colors.primary,
                label: 'No completados',
                value: weekly.incompleteDays,
              },
              {
                color: theme.colors.borderStrong,
                label: 'Sin plan',
                value: weekly.neutralDays,
              },
            ].map((item) => (
              <View key={item.label} style={styles.balanceRow}>
                <View
                  style={[styles.balanceDot, { backgroundColor: item.color }]}
                />
                <Text style={styles.balanceLabel} variant="label">
                  {item.label}
                </Text>
                <Text variant="bodyStrong">{item.value}</Text>
              </View>
            ))}
          </View>
          {weekly.neutralDays > 0 ? (
            <Text tone="muted" variant="caption">
              Los días sin plan no afectan a tu constancia.
            </Text>
          ) : null}
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
  metricCard: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: 2,
    justifyContent: 'space-between',
    minHeight: 112,
  },
  metricValue: { alignItems: 'baseline', flexDirection: 'row', gap: 4 },
  section: { gap: 10 },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  headingCopy: { flex: 1, gap: 1 },
  heatmapHeader: { flexDirection: 'row', gap: 6, marginBottom: 7 },
  heatmapHeaderLabel: { flex: 1 },
  heatmapGrid: { gap: 6 },
  heatmapWeek: { flexDirection: 'row', gap: 6 },
  heatCellSlot: { flex: 1 },
  heatCell: {
    aspectRatio: 1,
    borderRadius: 8,
    borderWidth: 1.5,
    width: '100%',
  },
  legend: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
    marginTop: 14,
  },
  legendItem: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  legendScale: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  legendCell: { borderRadius: 4, borderWidth: 1, height: 15, width: 15 },
  balanceCard: { gap: 14 },
  balanceLead: { gap: 1 },
  balanceValue: { alignItems: 'baseline', flexDirection: 'row', gap: 6 },
  balanceRows: { gap: 8 },
  balanceRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  balanceDot: { borderRadius: 999, height: 8, width: 8 },
  balanceLabel: { flex: 1 },
});
