import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/src/ThemeContext';

type Props = {
  size?: number;
  style?: object;
};

export function ThemeToggle({ size = 22, style }: Props) {
  const { isDark, toggleScheme, colors } = useTheme();

  return (
    <Pressable
      onPress={toggleScheme}
      accessibilityRole="button"
      accessibilityLabel={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      hitSlop={10}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: colors.surfaceMuted },
        pressed && { opacity: 0.75 },
        style,
      ]}
    >
      <Ionicons
        name={isDark ? 'sunny-outline' : 'moon-outline'}
        size={size}
        color={colors.text}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
