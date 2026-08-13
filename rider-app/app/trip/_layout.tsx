import { Stack } from 'expo-router';

export default function TripLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="to-store" />
      <Stack.Screen name="arrived" />
      <Stack.Screen name="pickup" />
      <Stack.Screen name="to-customer" />
      <Stack.Screen name="deliver" />
      <Stack.Screen name="complete" />
    </Stack>
  );
}
