import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Text } from '@/components/core';
import { useTheme } from '@/design';

type FormFieldProps = TextInputProps & {
  label: string;
  hint?: string;
  error?: string;
};

export function FormField({
  label,
  hint,
  error,
  style,
  ...props
}: FormFieldProps) {
  const theme = useTheme();
  return (
    <View style={styles.group}>
      <Text variant="label">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        maxFontSizeMultiplier={theme.accessibility.maxFontSizeMultiplier}
        placeholderTextColor={theme.colors.textMuted}
        selectionColor={theme.colors.primary}
        style={[
          styles.input,
          {
            backgroundColor: theme.colors.surface,
            borderColor: error ? theme.colors.danger : theme.colors.border,
            color: theme.colors.text,
            fontFamily: theme.typography.fontFamilies.regular,
          },
          props.multiline && styles.multiline,
          style,
        ]}
        {...props}
      />
      {error ? (
        <Text tone="danger" variant="caption">
          {error}
        </Text>
      ) : hint ? (
        <Text tone="muted" variant="caption">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  multiline: {
    minHeight: 104,
    textAlignVertical: 'top',
  },
});
