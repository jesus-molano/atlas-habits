import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  useFonts,
} from '@expo-google-fonts/manrope';
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider as NavigationThemeProvider,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { sqliteAtlasAppAdapter } from '@/application/atlas-app-adapter';
import { ThemeProvider as AtlasThemeProvider, useTheme } from '@/design';
import { AtlasAppProvider } from '@/features/atlas';

void SplashScreen.preventAutoHideAsync();

function AtlasNavigator() {
  const theme = useTheme();
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  const navigationTheme = useMemo(
    () => ({
      ...(theme.isDark ? DarkTheme : DefaultTheme),
      colors: {
        ...(theme.isDark ? DarkTheme.colors : DefaultTheme.colors),
        background: theme.colors.background,
        card: theme.colors.surface,
        border: theme.colors.border,
        text: theme.colors.text,
        primary: theme.colors.primary,
        notification: theme.colors.primary,
      },
    }),
    [theme],
  );

  return (
    <NavigationThemeProvider value={navigationTheme}>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          animation: 'fade_from_bottom',
          contentStyle: { backgroundColor: theme.colors.background },
          headerShown: false,
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="create"
          options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
        />
        <Stack.Screen
          name="routine/[id]"
          options={{ animation: 'slide_from_right', gestureEnabled: false }}
        />
      </Stack>
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AtlasThemeProvider defaultMode="system">
          <AtlasAppProvider adapter={sqliteAtlasAppAdapter}>
            <AtlasNavigator />
          </AtlasAppProvider>
        </AtlasThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
