import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { StoreRow } from '@/src/components/StoreRow';
import { FadeIn, FadeInFromBottom } from '@/src/components/motion';
import { useApp } from '@/src/AppContext';
import { useTheme } from '@/src/ThemeContext';
import { spacing } from '@/src/theme';

export default function StoresScreen() {
  const { stores, togglePause } = useApp();
  const { colors, typography } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: colors.bg },
        content: {
          padding: spacing.xl,
          gap: spacing.md,
          paddingBottom: spacing.xxl,
        },
        lead: { ...typography.caption, marginBottom: spacing.sm, lineHeight: 20 },
      }),
    [colors.bg, typography.caption],
  );

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <FadeIn delay={40}>
        <Text style={styles.lead}>
          Pause or resume deliveries for stores you&apos;re already linked to.
        </Text>
      </FadeIn>
      {stores.map((store, i) => (
        <FadeInFromBottom key={store.id} delay={100 + i * 70}>
          <StoreRow
            store={store}
            onToggle={() => togglePause(store.id)}
          />
        </FadeInFromBottom>
      ))}
    </ScrollView>
  );
}
