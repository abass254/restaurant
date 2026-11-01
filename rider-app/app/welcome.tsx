import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WelcomeHero } from '@/src/components/WelcomeHero';
import { ThemeToggle } from '@/src/components/ThemeToggle';
import { FadeIn, FadeInFromBottom, PressScale } from '@/src/components/motion';
import { useTheme } from '@/src/ThemeContext';
import { fonts, spacing } from '@/src/theme';

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          flex: 1,
          backgroundColor: colors.authBg,
        },
        hero: {
          flex: 1.15,
          minHeight: 280,
        },
        toggleWrap: {
          position: 'absolute',
          top: insets.top + 8,
          right: 24,
          zIndex: 2,
        },
        content: {
          paddingHorizontal: 24,
          paddingTop: 8,
          paddingBottom: spacing.sm,
        },
        eyebrow: {
          fontFamily: fonts.sans,
          fontSize: 15,
          color: colors.subtext,
          marginBottom: 10,
        },
        headline: {
          fontFamily: fonts.sansBold,
          fontSize: 32,
          lineHeight: 38,
          letterSpacing: -0.6,
          color: colors.heading,
          marginBottom: 28,
        },
        headlineAccent: {
          color: colors.primary,
          fontFamily: fonts.sansBold,
        },
        cta: {
          height: 56,
          borderRadius: 999,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
        },
        ctaLabel: {
          color: '#fff',
          fontFamily: fonts.sansBold,
          fontSize: 17,
        },
        footerLink: {
          marginTop: 20,
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          flexWrap: 'wrap',
        },
        footerMuted: {
          fontFamily: fonts.sans,
          fontSize: 14,
          color: colors.subtext,
        },
        footerAction: {
          fontFamily: fonts.sansSemi,
          fontSize: 14,
          color: colors.heading,
          textDecorationLine: 'underline',
        },
      }),
    [colors, insets.top],
  );

  return (
    <View style={[styles.root, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
      <View style={styles.hero}>
        <WelcomeHero />
        <View style={styles.toggleWrap}>
          <ThemeToggle />
        </View>
      </View>

      <View style={styles.content}>
        <FadeIn delay={80}>
          <Text style={styles.eyebrow}>Welcome to the TransChap Rider app</Text>
        </FadeIn>
        <FadeIn delay={160}>
          <Text style={styles.headline}>
            Start delivering today and{'\n'}
            <Text style={styles.headlineAccent}>earn money your way</Text>
          </Text>
        </FadeIn>

        <FadeInFromBottom delay={280}>
          <PressScale onPress={() => router.push('/login')}>
            <View style={styles.cta}>
              <Text style={styles.ctaLabel}>Let&apos;s ride</Text>
            </View>
          </PressScale>
        </FadeInFromBottom>

        <FadeIn delay={400}>
          <Pressable
            onPress={() => router.push('/login')}
            style={styles.footerLink}
            hitSlop={8}
          >
            <Text style={styles.footerMuted}>Already a rider? </Text>
            <Text style={styles.footerAction}>Sign in</Text>
          </Pressable>
        </FadeIn>
      </View>
    </View>
  );
}
