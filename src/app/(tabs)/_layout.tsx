import { Tabs, useRouter } from 'expo-router';
import {
  BarChart3,
  CalendarDays,
  ListTodo,
  Plus,
  Settings,
} from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/design';

export default function TabsLayout() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        lazy: true,
        sceneStyle: { backgroundColor: theme.colors.background },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarHideOnKeyboard: true,
        tabBarItemStyle: styles.tabItem,
        tabBarLabelStyle: {
          fontFamily: theme.typography.fontFamilies.medium,
          fontSize: 11,
          lineHeight: 15,
        },
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          height: 68 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 7,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Hoy',
          tabBarIcon: ({ color, focused, size }) => (
            <CalendarDays
              color={color}
              fill={focused ? color : 'transparent'}
              size={size}
              strokeWidth={focused ? 2.4 : 2}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: 'Plan',
          tabBarIcon: ({ color, focused, size }) => (
            <ListTodo
              color={color}
              size={size}
              strokeWidth={focused ? 2.4 : 2}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="create-fab"
        options={{
          title: '',
          tabBarAccessibilityLabel: 'Crear un hábito, tarea o rutina',
          tabBarButton: () => (
            <Pressable
              accessibilityLabel="Crear"
              accessibilityRole="button"
              android_ripple={{
                borderless: true,
                color: theme.colors.primaryMuted,
              }}
              onPress={() => router.push('/create')}
              style={({ pressed }) => [
                styles.fab,
                {
                  backgroundColor: pressed
                    ? theme.colors.primaryPressed
                    : theme.colors.primary,
                  borderColor: theme.colors.background,
                  shadowColor: theme.colors.primary,
                },
                pressed && styles.fabPressed,
              ]}
            >
              <Plus
                color={theme.colors.textInverse}
                size={28}
                strokeWidth={2.5}
              />
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: 'Estadísticas',
          tabBarIcon: ({ color, focused, size }) => (
            <BarChart3
              color={color}
              size={size}
              strokeWidth={focused ? 2.4 : 2}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Ajustes',
          tabBarIcon: ({ color, focused, size }) => (
            <Settings
              color={color}
              size={size}
              strokeWidth={focused ? 2.4 : 2}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabItem: { minHeight: 52 },
  fab: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 31,
    borderWidth: 5,
    elevation: 9,
    height: 62,
    justifyContent: 'center',
    marginTop: -23,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    width: 62,
  },
  fabPressed: { transform: [{ scale: 0.94 }] },
});
