import { Award, CalendarCheck, Flame, Route } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Card, ProgressOrbit, Screen, Text } from '@/components/core';
import { useTheme } from '@/design';
import { useAtlasApp } from '@/features/atlas';
import { PageHeader } from '@/features/ui';

function streaks(ratios: number[]): { current: number; best: number } {
  let best = 0;
  let running = 0;
  ratios.forEach((ratio) => {
    if (ratio >= 0.999) {
      running += 1;
      best = Math.max(best, running);
    } else {
      running = 0;
    }
  });
  let current = 0;
  for (let index = ratios.length - 1; index >= 0; index -= 1) {
    if ((ratios[index] ?? 0) < 0.999) break;
    current += 1;
  }
  return { current, best };
}

function weekday(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return parsed.toLocaleDateString('es-ES', { weekday: 'narrow' });
}

export function StatsScreen() {
  const theme = useTheme();
  const { snapshot, progress } = useAtlasApp();
  const recent = snapshot.history.slice(-35);
  const week = recent.slice(-7);
  const stats = streaks(recent.map((day) => day.ratio));
  const weeklyRatio =
    week.length === 0
      ? 0
      : week.reduce((sum, day) => sum + day.ratio, 0) / week.length;
  const bestHabit = [...snapshot.habits].sort((a, b) => b.streak - a.streak)[0];

  return (
    <Screen
      contentContainerStyle={styles.content}
      safeAreaEdges={['top', 'left', 'right']}
      scroll
    >
      <PageHeader
        description="Tendencias claras, sin puntos ni premios artificiales."
        eyebrow="Bitácora"
        title="Estadísticas"
      />

      <Card padding="lg" style={styles.weekCard} variant="raised">
        <ProgressOrbit
          accessibilityLabel={`Promedio semanal: ${Math.round(weeklyRatio * 100)}%`}
          label="semana"
          max={100}
          size={94}
          value={weeklyRatio * 100}
        />
        <View style={styles.weekCopy}>
          <Text tone="accent" variant="eyebrow">
            ÚLTIMOS 7 DÍAS
          </Text>
          <Text variant="heading">
            {Math.round(weeklyRatio * 100)}% de constancia
          </Text>
          <Text tone="secondary" variant="caption">
            {weeklyRatio >= 0.8
              ? 'Tu rumbo se mantiene estable.'
              : 'La constancia crece mejor con objetivos pequeños.'}
          </Text>
        </View>
      </Card>

      <View style={styles.metrics}>
        <Card padding="md" style={styles.metricCard} variant="default">
          <Flame color={theme.colors.primary} size={22} />
          <Text variant="metric">{stats.current}</Text>
          <Text tone="secondary" variant="caption">
            Racha actual
          </Text>
        </Card>
        <Card padding="md" style={styles.metricCard} variant="default">
          <Award color={theme.colors.accent} size={22} />
          <Text variant="metric">
            {Math.max(stats.best, bestHabit?.streak ?? 0)}
          </Text>
          <Text tone="secondary" variant="caption">
            Mejor racha
          </Text>
        </Card>
        <Card padding="md" style={styles.metricCard} variant="default">
          <CalendarCheck color={theme.colors.success} size={22} />
          <Text variant="metric">{progress.completed}</Text>
          <Text tone="secondary" variant="caption">
            Hoy
          </Text>
        </Card>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <View style={styles.headingIcon}>
            <Route color={theme.colors.primary} size={20} />
          </View>
          <View style={styles.headingCopy}>
            <Text variant="subheading">Mapa de constancia</Text>
            <Text tone="secondary" variant="caption">
              Cada punto representa un día. Más coral significa más progreso.
            </Text>
          </View>
        </View>
        <Card padding="lg" variant="outlined">
          <View
            accessibilityLabel="Progreso de los últimos 35 días"
            style={styles.heatmap}
          >
            {recent.map((day) => (
              <View
                accessibilityLabel={`${day.date}: ${Math.round(day.ratio * 100)}%`}
                key={day.date}
                style={[
                  styles.heatCell,
                  {
                    backgroundColor:
                      day.ratio === 0
                        ? theme.colors.track
                        : theme.colors.primary,
                    opacity: day.ratio === 0 ? 1 : 0.28 + day.ratio * 0.72,
                  },
                ]}
              />
            ))}
          </View>
          <View style={styles.legend}>
            <Text tone="muted" variant="caption">
              Menos
            </Text>
            {[0.22, 0.42, 0.66, 1].map((opacity) => (
              <View
                key={opacity}
                style={[
                  styles.legendCell,
                  { backgroundColor: theme.colors.primary, opacity },
                ]}
              />
            ))}
            <Text tone="muted" variant="caption">
              Más
            </Text>
          </View>
        </Card>
      </View>

      <View style={styles.section}>
        <Text variant="subheading">Última semana</Text>
        <Card padding="lg" style={styles.bars} variant="default">
          {week.map((day) => (
            <View
              accessibilityLabel={`${day.date}: ${Math.round(day.ratio * 100)}%`}
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
                      height: `${Math.max(8, day.ratio * 100)}%`,
                    },
                  ]}
                />
              </View>
              <Text variant="caption">{weekday(day.date)}</Text>
            </View>
          ))}
        </Card>
      </View>

      {bestHabit ? (
        <Card padding="lg" variant="tinted">
          <Text tone="accent" variant="eyebrow">
            PUNTO MÁS FIRME
          </Text>
          <Text style={styles.bestTitle} variant="subheading">
            {bestHabit.title}
          </Text>
          <Text tone="secondary" variant="caption">
            {bestHabit.streak} días de racha. La estadística cuenta progreso
            real y días omitidos justificados.
          </Text>
        </Card>
      ) : null}
      <View style={styles.bottomSpace} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 24, paddingBottom: 112, paddingTop: 12 },
  weekCard: { alignItems: 'center', flexDirection: 'row', gap: 18 },
  weekCopy: { flex: 1, gap: 5 },
  metrics: { flexDirection: 'row', gap: 10 },
  metricCard: { flex: 1, gap: 3, minWidth: 0 },
  section: { gap: 12 },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  headingIcon: { alignItems: 'center', width: 28 },
  headingCopy: { flex: 1, gap: 2 },
  heatmap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  heatCell: { aspectRatio: 1, borderRadius: 6, width: '12%' },
  legend: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'flex-end',
    marginTop: 14,
  },
  legendCell: { borderRadius: 3, height: 13, width: 13 },
  bars: { alignItems: 'flex-end', flexDirection: 'row', gap: 8, height: 190 },
  barColumn: {
    alignItems: 'center',
    flex: 1,
    gap: 6,
    height: '100%',
    justifyContent: 'flex-end',
  },
  barTrack: {
    borderRadius: 999,
    flex: 1,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    width: 15,
  },
  barFill: { borderRadius: 999, width: '100%' },
  bestTitle: { marginBottom: 4, marginTop: 5 },
  bottomSpace: { height: 12 },
});
