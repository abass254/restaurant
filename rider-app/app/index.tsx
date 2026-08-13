import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useApp } from '@/src/AppContext';
import { useTheme } from '@/src/ThemeContext';

export default function Index() {
  const { loggedIn, authLoading } = useApp();
  const { colors } = useTheme();

  if (authLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return <Redirect href={loggedIn ? '/(tabs)/home' : '/welcome'} />;
}
