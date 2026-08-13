import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const SESSION_KEY = 'dukai.rider.session_token';

async function canUseSecureStore(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function getSessionToken(): Promise<string | null> {
  try {
    if (await canUseSecureStore()) {
      return (await SecureStore.getItemAsync(SESSION_KEY)) || null;
    }
    return (await AsyncStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
}

export async function setSessionToken(token: string): Promise<void> {
  if (await canUseSecureStore()) {
    await SecureStore.setItemAsync(SESSION_KEY, token);
    return;
  }
  await AsyncStorage.setItem(SESSION_KEY, token);
}

export async function clearSessionToken(): Promise<void> {
  try {
    if (await canUseSecureStore()) {
      await SecureStore.deleteItemAsync(SESSION_KEY);
    }
    await AsyncStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}
