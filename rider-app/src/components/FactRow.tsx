import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/src/ThemeContext';
import { fonts, radius, spacing } from '@/src/theme';

type Props = {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
};

export function FactRow({ icon = 'information-circle-outline', label, value }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: spacing.md,
          paddingVertical: spacing.sm,
        },
        iconWrap: {
          width: 36,
          height: 36,
          borderRadius: radius.sm,
          backgroundColor: colors.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
        },
        text: { flex: 1, gap: 2 },
        value: {
          fontFamily: fonts.sansSemi,
          fontSize: 16,
          color: colors.text,
        },
      }),
    [colors.surfaceMuted, colors.text],
  );

  return (
    <View style={styles.row}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <View style={styles.text}>
        <Text style={typography.caption}>{label}</Text>
        <Text style={styles.value}>{value}</Text>
      </View>
    </View>
  );
}
