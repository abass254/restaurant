import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useApp, type RiderProfile } from '@/src/AppContext';
import {
  canUseOsNotifications,
  getNotificationPermissionStatus,
  requestNotificationPermission,
  useAlerts,
} from '@/src/alerts';
import { FadeIn, PressScale } from '@/src/components/motion';
import { ThemeToggle } from '@/src/components/ThemeToggle';
import { useTheme } from '@/src/ThemeContext';
import { fonts, radius, spacing } from '@/src/theme';

const VEHICLE_OPTIONS = ['Motorcycle', 'Bicycle', 'Car', 'Van'] as const;

type FieldKey = keyof Omit<RiderProfile, 'photoUri'>;

type FieldStyles = {
  field: ViewStyle;
  label: TextStyle;
  input: TextStyle;
};

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { profile, profileLoaded, updateProfile, logout } = useApp();
  const { preferences, updatePreferences } = useAlerts();
  const { colors, shadow, typography } = useTheme();
  const [draft, setDraft] = useState<RiderProfile>(profile);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [notifStatus, setNotifStatus] = useState<
    'granted' | 'denied' | 'undetermined' | 'unavailable'
  >(canUseOsNotifications() ? 'undetermined' : 'unavailable');

  useEffect(() => {
    if (profileLoaded) setDraft(profile);
  }, [profileLoaded, profile]);

  useEffect(() => {
    getNotificationPermissionStatus().then(setNotifStatus).catch(() => undefined);
  }, []);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(profile),
    [draft, profile],
  );

  const setField = useCallback(<K extends FieldKey>(key: K, value: RiderProfile[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const pickPhoto = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photo access needed',
        'Allow photo library access to upload a profile picture.',
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      setDraft((prev) => ({ ...prev, photoUri: result.assets[0].uri }));
    }
  }, []);

  const takePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access needed', 'Allow camera access to take a profile photo.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      setDraft((prev) => ({ ...prev, photoUri: result.assets[0].uri }));
    }
  }, []);

  const onPhotoPress = useCallback(() => {
    Alert.alert('Profile photo', 'Choose how to update your photo', [
      { text: 'Take photo', onPress: () => void takePhoto() },
      { text: 'Choose from library', onPress: () => void pickPhoto() },
      ...(draft.photoUri
        ? [
            {
              text: 'Remove photo',
              style: 'destructive' as const,
              onPress: () => setDraft((prev) => ({ ...prev, photoUri: null })),
            },
          ]
        : []),
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [draft.photoUri, pickPhoto, takePhoto]);

  const onSave = useCallback(async () => {
    if (!draft.name.trim()) {
      Alert.alert('Name required', 'Please enter your name.');
      return;
    }
    setSaving(true);
    try {
      await updateProfile({
        ...draft,
        name: draft.name.trim(),
        phone: draft.phone.trim(),
        email: draft.email.trim(),
        plateNumber: draft.plateNumber.trim(),
        city: draft.city.trim(),
        bio: draft.bio.trim(),
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } finally {
      setSaving(false);
    }
  }, [draft, updateProfile]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: colors.bg },
        topBar: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.md,
        },
        backBtn: {
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          ...shadow.card,
        },
        title: {
          fontFamily: fonts.display,
          fontSize: 20,
          color: colors.text,
        },
        scroll: {
          paddingHorizontal: spacing.xl,
          paddingBottom: spacing.xxl + 80,
        },
        avatarWrap: {
          alignItems: 'center',
          marginBottom: spacing.xl,
          marginTop: spacing.sm,
        },
        avatarBtn: {
          width: 112,
          height: 112,
          borderRadius: 56,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          ...shadow.card,
        },
        avatarImage: {
          width: '100%',
          height: '100%',
        },
        cameraBadge: {
          position: 'absolute',
          right: -2,
          bottom: -2,
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 3,
          borderColor: colors.bg,
        },
        avatarHint: {
          ...typography.caption,
          marginTop: spacing.md,
        },
        card: {
          backgroundColor: colors.surface,
          borderRadius: radius.xxl,
          padding: spacing.lg,
          gap: spacing.md,
          marginBottom: spacing.lg,
          ...shadow.card,
        },
        sectionLabel: {
          fontFamily: fonts.sansSemi,
          fontSize: 12,
          color: colors.muted,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          marginBottom: 2,
        },
        field: { gap: 6 },
        label: {
          fontFamily: fonts.sansMedium,
          fontSize: 13,
          color: colors.muted,
        },
        input: {
          height: 50,
          borderRadius: radius.md,
          backgroundColor: colors.surfaceMuted,
          paddingHorizontal: spacing.lg,
          fontFamily: fonts.sans,
          fontSize: 16,
          color: colors.text,
        },
        textarea: {
          minHeight: 96,
          paddingTop: 14,
          paddingBottom: 14,
          textAlignVertical: 'top' as const,
        },
        chips: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: spacing.sm,
        },
        chip: {
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: radius.cta,
          backgroundColor: colors.surfaceMuted,
        },
        chipActive: {
          backgroundColor: colors.primary,
        },
        chipText: {
          fontFamily: fonts.sansSemi,
          fontSize: 13,
          color: colors.text,
        },
        chipTextActive: {
          color: '#fff',
        },
        footer: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: spacing.xl,
          paddingTop: spacing.md,
          backgroundColor: colors.bg,
          gap: spacing.sm,
        },
        saveBtn: {
          height: 56,
          borderRadius: radius.xl,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          ...shadow.cta,
        },
        saveLabel: {
          color: '#fff',
          fontFamily: fonts.sansBold,
          fontSize: 16,
        },
        flash: {
          textAlign: 'center',
          fontFamily: fonts.sansSemi,
          fontSize: 13,
          color: colors.primary,
        },
        logoutBtn: {
          alignItems: 'center',
          paddingVertical: spacing.md,
        },
        logoutText: {
          fontFamily: fonts.sansSemi,
          fontSize: 14,
          color: colors.danger,
        },
        toggleRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.md,
          paddingVertical: 4,
        },
        toggleMeta: {
          flex: 1,
          gap: 2,
        },
        toggleTitle: {
          fontFamily: fonts.sansSemi,
          fontSize: 15,
          color: colors.text,
        },
        switchTrack: {
          width: 50,
          height: 30,
          borderRadius: 15,
          padding: 3,
          justifyContent: 'center',
        },
        switchThumb: {
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: '#fff',
        },
        enableBtn: {
          marginTop: spacing.sm,
          alignSelf: 'flex-start',
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: radius.cta,
          backgroundColor: colors.primarySoft,
        },
        enableBtnText: {
          fontFamily: fonts.sansSemi,
          fontSize: 13,
          color: colors.primary,
        },
        helper: {
          ...typography.caption,
          marginTop: spacing.sm,
          lineHeight: 18,
        },
      }),
    [colors, shadow, typography],
  );

  const onEnableNotifications = useCallback(async () => {
    const ok = await requestNotificationPermission();
    setNotifStatus(ok ? 'granted' : 'denied');
    if (ok) {
      await updatePreferences({ notificationsEnabled: true });
    } else {
      Alert.alert(
        'Notifications blocked',
        'Enable notifications in system settings to get alerts for new offers.',
      );
    }
  }, [updatePreferences]);

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.topBar}>
        <Pressable
          style={styles.backBtn}
          onPress={() => router.back()}
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Profile</Text>
        <ThemeToggle />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <FadeIn delay={40}>
          <View style={styles.avatarWrap}>
            <PressScale onPress={onPhotoPress} accessibilityLabel="Upload profile photo">
              <View>
                <View style={styles.avatarBtn}>
                  {draft.photoUri ? (
                    <Image source={{ uri: draft.photoUri }} style={styles.avatarImage} />
                  ) : (
                    <Ionicons name="person" size={42} color={colors.primary} />
                  )}
                </View>
                <View style={styles.cameraBadge}>
                  <Ionicons name="camera" size={16} color="#fff" />
                </View>
              </View>
            </PressScale>
            <Text style={styles.avatarHint}>Tap to upload a photo</Text>
          </View>
        </FadeIn>

        <FadeIn delay={120}>
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Basic info</Text>
            <Field
              label="Full name"
              value={draft.name}
              onChangeText={(v) => setField('name', v)}
              styles={styles}
              placeholder="Your name"
              autoCapitalize="words"
            />
            <Field
              label="Phone"
              value={draft.phone}
              onChangeText={(v) => setField('phone', v)}
              styles={styles}
              placeholder="+254…"
              keyboardType="phone-pad"
            />
            <Field
              label="Email"
              value={draft.email}
              onChangeText={(v) => setField('email', v)}
              styles={styles}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Field
              label="City"
              value={draft.city}
              onChangeText={(v) => setField('city', v)}
              styles={styles}
              placeholder="Nairobi"
              autoCapitalize="words"
            />
          </View>
        </FadeIn>

        <FadeIn delay={200}>
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Vehicle</Text>
            <View style={styles.field}>
              <Text style={styles.label}>Type</Text>
              <View style={styles.chips}>
                {VEHICLE_OPTIONS.map((opt) => {
                  const active = draft.vehicleType === opt;
                  return (
                    <Pressable
                      key={opt}
                      onPress={() => setField('vehicleType', opt)}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {opt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <Field
              label="Plate number"
              value={draft.plateNumber}
              onChangeText={(v) => setField('plateNumber', v)}
              styles={styles}
              placeholder="KDA 123A"
              autoCapitalize="characters"
            />
          </View>
        </FadeIn>

        <FadeIn delay={280}>
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>About</Text>
            <View style={styles.field}>
              <Text style={styles.label}>Bio</Text>
              <TextInput
                value={draft.bio}
                onChangeText={(v) => setField('bio', v)}
                placeholder="A short note about you"
                placeholderTextColor={colors.muted}
                multiline
                style={[styles.input, styles.textarea]}
              />
            </View>
          </View>
        </FadeIn>

        <FadeIn delay={320}>
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Alerts</Text>
            <ToggleRow
              title="Sounds"
              subtitle="Play tones for offers and trip updates"
              value={preferences.soundsEnabled}
              onChange={(v) => void updatePreferences({ soundsEnabled: v })}
              styles={styles}
              colors={colors}
            />
            <ToggleRow
              title="Haptics"
              subtitle="Vibrate on accept and milestones"
              value={preferences.hapticsEnabled}
              onChange={(v) => void updatePreferences({ hapticsEnabled: v })}
              styles={styles}
              colors={colors}
            />
            <ToggleRow
              title="Notifications"
              subtitle="Alert you when a new offer arrives"
              value={preferences.notificationsEnabled}
              onChange={(v) => void updatePreferences({ notificationsEnabled: v })}
              styles={styles}
              colors={colors}
            />
            {notifStatus !== 'granted' && notifStatus !== 'unavailable' ? (
              <Pressable style={styles.enableBtn} onPress={() => void onEnableNotifications()}>
                <Text style={styles.enableBtnText}>
                  {notifStatus === 'denied' ? 'Open permission help' : 'Enable notifications'}
                </Text>
              </Pressable>
            ) : null}
            <Text style={styles.helper}>
              {notifStatus === 'unavailable'
                ? 'In Expo Go on Android, OS notifications are unavailable — you’ll still get sounds, haptics, and in-app banners. Use a development build for system notifications.'
                : 'While you’re online, TransChap will sound and notify you about new delivery offers.'}
            </Text>
          </View>
        </FadeIn>

        <FadeIn delay={380}>
          <Pressable
            style={styles.logoutBtn}
            onPress={() => {
              void logout().then(() => {
                router.replace('/welcome');
              });
            }}
          >
            <Text style={styles.logoutText}>Sign out</Text>
          </Pressable>
        </FadeIn>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        {savedFlash ? <Text style={styles.flash}>Profile saved</Text> : null}
        <PressScale
          onPress={() => void onSave()}
          disabled={saving || !dirty}
          accessibilityLabel="Save profile"
        >
          <View
            style={[
              styles.saveBtn,
              (!dirty || saving) && { opacity: 0.45 },
            ]}
          >
            <Text style={styles.saveLabel}>{saving ? 'Saving…' : 'Save changes'}</Text>
          </View>
        </PressScale>
      </View>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  styles,
  placeholder,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  styles: FieldStyles;
  placeholder?: string;
  keyboardType?: 'default' | 'phone-pad' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={styles.input}
      />
    </View>
  );
}

function ToggleRow({
  title,
  subtitle,
  value,
  onChange,
  styles,
  colors,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (value: boolean) => void;
  styles: {
    toggleRow: ViewStyle;
    toggleMeta: ViewStyle;
    toggleTitle: TextStyle;
    switchTrack: ViewStyle;
    switchThumb: ViewStyle;
  };
  colors: { primary: string; surfaceMuted: string; muted: string };
}) {
  return (
    <Pressable
      style={styles.toggleRow}
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
    >
      <View style={styles.toggleMeta}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={{ fontFamily: fonts.sans, fontSize: 12, color: colors.muted, lineHeight: 16 }}>
          {subtitle}
        </Text>
      </View>
      <View
        style={[
          styles.switchTrack,
          { backgroundColor: value ? colors.primary : colors.surfaceMuted },
        ]}
      >
        <View
          style={[
            styles.switchThumb,
            { alignSelf: value ? 'flex-end' : 'flex-start' },
          ]}
        />
      </View>
    </Pressable>
  );
}
