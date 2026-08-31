import type { PropsWithChildren } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme, type AtlasColorToken } from '@/design';

export type ScreenProps = PropsWithChildren<{
  scroll?: boolean;
  padded?: boolean;
  background?: AtlasColorToken;
  safeAreaEdges?: readonly Edge[];
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollProps?: Omit<
    ScrollViewProps,
    'children' | 'contentContainerStyle' | 'style'
  >;
  testID?: string;
}>;

export function Screen({
  children,
  scroll = false,
  padded = true,
  background = 'background',
  safeAreaEdges = ['top', 'right', 'bottom', 'left'],
  style,
  contentContainerStyle,
  scrollProps,
  testID,
}: ScreenProps) {
  const theme = useTheme();
  const contentStyle: StyleProp<ViewStyle> = [
    styles.content,
    { maxWidth: theme.layout.contentMaxWidth },
    padded && { paddingHorizontal: theme.layout.screenGutter },
    contentContainerStyle,
  ];

  return (
    <SafeAreaView
      edges={[...safeAreaEdges]}
      style={[
        styles.safeArea,
        { backgroundColor: theme.colors[background] },
        style,
      ]}
      testID={testID}
    >
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          {...scrollProps}
        >
          <View style={contentStyle}>{children}</View>
        </ScrollView>
      ) : (
        <View style={contentStyle}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: {
    alignSelf: 'center',
    flex: 1,
    width: '100%',
  },
});
