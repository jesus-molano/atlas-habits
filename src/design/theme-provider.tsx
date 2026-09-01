import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';

import {
  createAtlasTheme,
  type AtlasScheme,
  type AtlasTheme,
  type ThemeMode,
} from './themes';

type ThemeContextValue = {
  theme: AtlasTheme;
  mode: ThemeMode;
  scheme: AtlasScheme;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME_MODE_STORAGE_KEY = 'atlas.settings.theme-mode';

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

export type ThemeProviderProps = PropsWithChildren<{
  /** Uses system appearance unless a controlled `mode` is supplied. */
  defaultMode?: ThemeMode;
  mode?: ThemeMode;
  onModeChange?: (mode: ThemeMode) => void;
}>;

function useAccessibilityPreferences() {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [highContrast, setHighContrast] = useState(false);

  useEffect(() => {
    let mounted = true;

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => mounted && setReduceMotion(enabled))
      .catch(() => undefined);
    void AccessibilityInfo.isHighTextContrastEnabled()
      .then((enabled) => mounted && setHighContrast(enabled))
      .catch(() => undefined);

    const motionSubscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    const contrastSubscription = AccessibilityInfo.addEventListener(
      'highTextContrastChanged',
      setHighContrast,
    );

    return () => {
      mounted = false;
      motionSubscription.remove();
      contrastSubscription.remove();
    };
  }, []);

  return { reduceMotion, highContrast };
}

export function ThemeProvider({
  children,
  defaultMode = 'system',
  mode: controlledMode,
  onModeChange,
}: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const [internalMode, setInternalMode] = useState<ThemeMode>(defaultMode);
  const [hasRestoredInternalMode, setHasRestoredInternalMode] = useState(false);
  const { highContrast, reduceMotion } = useAccessibilityPreferences();
  const mode = controlledMode ?? internalMode;
  const scheme: AtlasScheme =
    mode === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : mode;

  useEffect(() => {
    if (controlledMode !== undefined) return;

    let active = true;

    void AsyncStorage.getItem(THEME_MODE_STORAGE_KEY)
      .then((storedMode) => {
        if (active && isThemeMode(storedMode)) {
          setInternalMode(storedMode);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setHasRestoredInternalMode(true);
      });

    return () => {
      active = false;
    };
  }, [controlledMode]);

  const setMode = useCallback(
    (nextMode: ThemeMode) => {
      if (controlledMode === undefined) {
        setInternalMode(nextMode);
      }
      void AsyncStorage.setItem(THEME_MODE_STORAGE_KEY, nextMode).catch(
        () => undefined,
      );
      onModeChange?.(nextMode);
    },
    [controlledMode, onModeChange],
  );

  const theme = useMemo(
    () => createAtlasTheme(scheme, { highContrast, reduceMotion }),
    [highContrast, reduceMotion, scheme],
  );

  const value = useMemo(
    () => ({ theme, mode, scheme, setMode }),
    [mode, scheme, setMode, theme],
  );

  const hasRestoredMode =
    controlledMode !== undefined || hasRestoredInternalMode;
  if (!hasRestoredMode) return null;

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useThemeContext(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error(
      'useThemeContext must be used within an Atlas ThemeProvider.',
    );
  }

  return context;
}

export function useAtlasTheme(): AtlasTheme {
  return useThemeContext().theme;
}

export { useAtlasTheme as useTheme };
