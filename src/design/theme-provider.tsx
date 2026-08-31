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
  const { highContrast, reduceMotion } = useAccessibilityPreferences();
  const mode = controlledMode ?? internalMode;
  const scheme: AtlasScheme =
    mode === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : mode;

  const setMode = useCallback(
    (nextMode: ThemeMode) => {
      if (controlledMode === undefined) {
        setInternalMode(nextMode);
      }
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
