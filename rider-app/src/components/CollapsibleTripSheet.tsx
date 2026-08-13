import { ReactNode, useMemo, useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/src/ThemeContext';
import { fonts, radius, spacing } from '@/src/theme';

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
};

/**
 * Bottom sheet that snaps open/closed so the rider can pull it down
 * and see a taller map behind it.
 */
export function CollapsibleTripSheet({ title, subtitle, children, footer }: Props) {
  const insets = useSafeAreaInsets();
  const { height: windowH } = useWindowDimensions();
  const { colors, shadow, typography } = useTheme();
  const [expanded, setExpanded] = useState(true);

  const expandedH = Math.round(windowH * 0.58);
  const collapsedH = Math.round(120 + insets.bottom + spacing.lg * 2);
  const sheetH = useSharedValue(expandedH);
  const startH = useSharedValue(expandedH);

  const snapTo = (open: boolean) => {
    setExpanded(open);
    sheetH.value = withSpring(open ? expandedH : collapsedH, {
      damping: 22,
      stiffness: 220,
    });
  };

  const pan = Gesture.Pan()
    .onBegin(() => {
      startH.value = sheetH.value;
    })
    .onUpdate((e) => {
      const next = startH.value - e.translationY;
      const min = collapsedH;
      const max = expandedH;
      sheetH.value = Math.max(min, Math.min(max, next));
    })
    .onEnd((e) => {
      const mid = (expandedH + collapsedH) / 2;
      const shouldOpen =
        e.velocityY < -400 ? true : e.velocityY > 400 ? false : sheetH.value > mid;
      runOnJS(snapTo)(shouldOpen);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    height: sheetH.value,
  }));

  const onLayoutRoot = (_e: LayoutChangeEvent) => {
    // keep shared values in sync if rotation / insets change
    sheetH.value = expanded ? expandedH : collapsedH;
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
        },
        sheet: {
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius.xxl,
          borderTopRightRadius: radius.xxl,
          paddingHorizontal: spacing.xl,
          paddingTop: spacing.sm,
          overflow: 'hidden',
          ...shadow.lift,
        },
        handleHit: {
          alignItems: 'center',
          paddingVertical: spacing.sm,
          marginBottom: spacing.xs,
        },
        handle: {
          width: 42,
          height: 4,
          borderRadius: 2,
          backgroundColor: colors.border,
        },
        peekHint: {
          fontFamily: fonts.sans,
          fontSize: 11,
          color: colors.muted,
          marginTop: 6,
        },
        title: {
          fontFamily: fonts.display,
          fontSize: 24,
          color: colors.text,
        },
        sub: {
          ...typography.caption,
          color: colors.muted,
          marginTop: 4,
          lineHeight: 20,
        },
        body: {
          flex: 1,
          marginTop: spacing.sm,
        },
        footer: {
          marginTop: spacing.md,
          gap: spacing.sm,
          paddingBottom: Math.max(insets.bottom, spacing.md),
        },
        peekRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.md,
        },
        peekTitle: {
          flex: 1,
          fontFamily: fonts.sansSemi,
          fontSize: 16,
          color: colors.text,
        },
        expandChip: {
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: radius.cta,
          backgroundColor: colors.primarySoft,
        },
        expandChipText: {
          fontFamily: fonts.sansSemi,
          fontSize: 12,
          color: colors.primary,
        },
      }),
    [colors, insets.bottom, shadow.lift, typography.caption],
  );

  return (
    <Animated.View
      style={[styles.wrap, animatedStyle]}
      onLayout={onLayoutRoot}
      pointerEvents="box-none"
    >
      <View style={[styles.sheet, { flex: 1 }]}>
        <GestureDetector gesture={pan}>
          <Pressable
            style={styles.handleHit}
            onPress={() => snapTo(!expanded)}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Show more map' : 'Expand trip details'}
          >
            <View style={styles.handle} />
            <Text style={styles.peekHint}>
              {expanded ? 'Drag down for more map' : 'Drag up for trip details'}
            </Text>
          </Pressable>
        </GestureDetector>

        {expanded ? (
          <>
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
            {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
            <ScrollView
              style={styles.body}
              contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.sm }}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {children}
            </ScrollView>
          </>
        ) : (
          <View style={styles.peekRow}>
            <Text style={styles.peekTitle} numberOfLines={1}>
              {title}
            </Text>
            <Pressable style={styles.expandChip} onPress={() => snapTo(true)}>
              <Text style={styles.expandChipText}>Details</Text>
            </Pressable>
          </View>
        )}

        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </Animated.View>
  );
}
