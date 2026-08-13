import { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/src/ThemeContext';
import { fonts, spacing } from '@/src/theme';

type Props = {
  label: string;
  onPress: () => void;
  danger?: boolean;
};

export function TextButton({ label, onPress, danger }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          paddingVertical: spacing.md,
          alignItems: 'center',
        },
        text: {
          fontSize: 15,
          fontFamily: fonts.sansMedium,
          color: colors.muted,
        },
      }),
    [colors.muted],
  );

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }, styles.wrap]}>
      <Text style={[styles.text, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}
