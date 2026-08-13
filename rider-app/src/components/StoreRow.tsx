import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/src/ThemeContext';
import { fonts, radius, spacing } from '@/src/theme';
import { MockStore } from '@/src/data/mockStores';

type Props = {
  store: MockStore;
  onToggle: () => void;
};

export function StoreRow({ store, onToggle }: Props) {
  const { colors, shadow, typography } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: colors.surface,
          borderRadius: radius.xl,
          padding: spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.md,
          ...shadow.card,
        },
        left: { flexDirection: 'row', flex: 1, gap: spacing.md, alignItems: 'flex-start' },
        iconWrap: {
          width: 52,
          height: 52,
          borderRadius: radius.md,
          backgroundColor: colors.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
        },
        meta: { flex: 1, gap: 4 },
        name: {
          fontFamily: fonts.display,
          fontSize: 18,
          color: colors.text,
        },
        chip: {
          alignSelf: 'flex-start',
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: radius.cta,
          marginTop: 6,
        },
        chipOn: { backgroundColor: colors.primary },
        chipPaused: { backgroundColor: colors.dangerSoft },
        chipText: { fontSize: 12, fontFamily: fonts.sansMedium },
        toggle: {
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderRadius: radius.lg,
        },
        toggleOn: { backgroundColor: colors.surfaceMuted },
        toggleOff: { backgroundColor: colors.primary },
        toggleText: {
          color: colors.text,
          fontFamily: fonts.sansSemi,
          fontSize: 13,
        },
      }),
    [colors, shadow.card, typography.caption],
  );

  return (
    <View style={styles.card}>
      <View style={styles.left}>
        <View style={styles.iconWrap}>
          <Ionicons name="storefront" size={22} color={colors.primary} />
        </View>
        <View style={styles.meta}>
          <Text style={styles.name}>{store.name}</Text>
          <Text style={typography.caption}>{store.location}</Text>
          <View
            style={[
              styles.chip,
              store.paused ? styles.chipPaused : styles.chipOn,
            ]}
          >
            <Text
              style={[
                styles.chipText,
                { color: store.paused ? colors.danger : '#fff' },
              ]}
            >
              {store.paused ? 'Paused' : 'Deliveries on'}
            </Text>
          </View>
        </View>
      </View>
      <Pressable
        onPress={onToggle}
        style={[styles.toggle, store.paused ? styles.toggleOff : styles.toggleOn]}
      >
        <Text style={[styles.toggleText, store.paused && { color: '#fff' }]}>
          {store.paused ? 'Resume' : 'Pause'}
        </Text>
      </Pressable>
    </View>
  );
}
