import { ReactNode, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/src/ThemeContext';
import { radius, spacing } from '@/src/theme';

type Props = {
  children: ReactNode;
  footer?: ReactNode;
};

export function BottomSheet({ children, footer }: Props) {
  const insets = useSafeAreaInsets();
  const { colors, shadow } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        sheet: {
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius.xxl,
          borderTopRightRadius: radius.xxl,
          paddingHorizontal: spacing.xl,
          paddingTop: spacing.sm,
          ...shadow.lift,
        },
        handle: {
          alignSelf: 'center',
          width: 42,
          height: 4,
          borderRadius: 2,
          backgroundColor: colors.border,
          marginBottom: spacing.md,
        },
        body: {
          maxHeight: 320,
        },
        footer: {
          marginTop: spacing.lg,
          gap: spacing.sm,
        },
      }),
    [colors.border, colors.surface, shadow.lift],
  );

  return (
    <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
      <View style={styles.handle} />
      <ScrollView
        style={styles.body}
        contentContainerStyle={{ gap: spacing.sm }}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {children}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}
