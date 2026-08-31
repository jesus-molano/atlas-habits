import { Check } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/design';

type CheckControlProps = {
  checked: boolean;
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

export function CheckControl({
  checked,
  label,
  onPress,
  disabled = false,
}: CheckControlProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.control,
        {
          backgroundColor: checked ? theme.colors.primary : 'transparent',
          borderColor: checked
            ? theme.colors.primary
            : theme.colors.borderStrong,
          opacity: disabled ? 0.45 : pressed ? 0.72 : 1,
        },
      ]}
    >
      {checked ? (
        <Check color={theme.colors.textInverse} size={20} strokeWidth={3} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  control: {
    alignItems: 'center',
    borderRadius: 15,
    borderWidth: 1.5,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
});
