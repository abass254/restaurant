import { useEffect } from 'react';
import { Pressable, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  FadeInUp,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const SPRING = { damping: 18, stiffness: 160, mass: 0.8 };
const EASE_OUT = Easing.out(Easing.cubic);

type FadeProps = {
  children: React.ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
};

/** Soft rise + fade on mount — use for stacked page content. */
export function FadeIn({ children, delay = 0, style }: FadeProps) {
  return (
    <Animated.View
      entering={FadeInDown.delay(delay).duration(480).easing(EASE_OUT).springify().damping(18)}
      style={style}
    >
      {children}
    </Animated.View>
  );
}

export function FadeInFromBottom({ children, delay = 0, style }: FadeProps) {
  return (
    <Animated.View
      entering={FadeInUp.delay(delay).duration(520).easing(EASE_OUT)}
      style={style}
    >
      {children}
    </Animated.View>
  );
}

type PulseProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  active?: boolean;
};

/** Gentle breathing scale — great for the Go Online CTA. */
export function Pulse({ children, style, active = true }: PulseProps) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!active) {
      scale.value = withTiming(1, { duration: 200 });
      return;
    }
    scale.value = withRepeat(
      withSequence(
        withTiming(1.04, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
  }, [active, scale]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return <Animated.View style={[style, animStyle]}>{children}</Animated.View>;
}

/** Soft expanding ring behind an online/active indicator. */
export function PulseRing({ color, size = 8 }: { color: string; size?: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    );
  }, [progress]);

  const ringStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    width: size * 3,
    height: size * 3,
    borderRadius: (size * 3) / 2,
    backgroundColor: color,
    opacity: interpolate(progress.value, [0, 1], [0.45, 0]),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.4, 1.35]) }],
  }));

  return (
    <Animated.View
      style={{
        width: size * 3,
        height: size * 3,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Animated.View style={ringStyle} />
      <Animated.View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        }}
      />
    </Animated.View>
  );
}

type PressScaleProps = {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link' | 'none';
};

/** Pressable with springy scale feedback. */
export function PressScale({
  children,
  onPress,
  style,
  disabled,
  accessibilityLabel,
  accessibilityRole = 'button',
}: PressScaleProps) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[style, animStyle]}>
      <Pressable
        disabled={disabled}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        onPressIn={() => {
          scale.value = withSpring(0.96, SPRING);
        }}
        onPressOut={() => {
          scale.value = withSpring(1, SPRING);
        }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/** Animate a numeric-looking enter for badges. */
export function PopIn({ children, delay = 0, style }: FadeProps) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.86);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 320, easing: EASE_OUT }));
    scale.value = withDelay(delay, withSpring(1, { damping: 14, stiffness: 200 }));
  }, [delay, opacity, scale]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return <Animated.View style={[style, animStyle]}>{children}</Animated.View>;
}
