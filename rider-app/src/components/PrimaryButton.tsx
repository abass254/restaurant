import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { useTheme } from '@/src/ThemeContext';
import { fonts, radius, spacing } from '@/src/theme';

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'danger' | 'outline';
  style?: ViewStyle;
  disabled?: boolean;
};

export function PrimaryButton({
  label,
  onPress,
  variant = 'primary',
  style,
  disabled,
}: Props) {
  const { colors, shadow } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        btn: {
          height: 56,
          borderRadius: radius.xl,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: spacing.xl,
        },
        label: {
          fontSize: 16,
          fontFamily: fonts.sansSemi,
          letterSpacing: 0.2,
        },
      }),
    [],
  );

  const bg =
    variant === 'primary'
      ? colors.primary
      : variant === 'danger'
        ? colors.danger
        : colors.surface;
  const color = variant === 'outline' ? colors.text : '#fff';
  const border =
    variant === 'outline'
      ? { borderWidth: 1, borderColor: colors.border }
      : undefined;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' ? shadow.cta : null,
        {
          backgroundColor:
            pressed && variant === 'primary' ? colors.primaryPressed : bg,
          opacity: disabled ? 0.5 : pressed && variant !== 'primary' ? 0.88 : 1,
        },
        border,
        style,
      ]}
    >
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Pressable>
  );
}
