import { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export function WelcomeHero() {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(1.06);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) });
    scale.value = withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) });
  }, [opacity, scale]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.imageWrap, animStyle]}>
        <Image
          source={require('../../assets/images/welcome-hero.png')}
          style={styles.image}
          resizeMode="cover"
          accessibilityLabel="Rider delivering with DukAI"
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#F3EEE6',
  },
  imageWrap: {
    width: '100%',
    height: '100%',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
