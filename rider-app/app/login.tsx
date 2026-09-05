import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ThemeToggle } from '@/src/components/ThemeToggle';
import { useApp } from '@/src/AppContext';
import { useTheme } from '@/src/ThemeContext';
import { requestLoginCode, tripHref, verifyLoginCode } from '@/src/api';
import { fonts, spacing } from '@/src/theme';

type Mode = 'phone' | 'email';

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('254') && digits.length >= 12) return `+${digits}`;
  if (digits.startsWith('0') && digits.length >= 10) return `+254${digits.slice(1)}`;
  if (digits.length === 9 && (digits.startsWith('7') || digits.startsWith('1'))) {
    return `+254${digits}`;
  }
  return raw.trim().startsWith('+') ? `+${digits}` : `+${digits}`;
}

function isValidPhoneInput(raw: string): boolean {
  return normalizePhone(raw).length >= 12; // e.g. +2547XXXXXXXX
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { onAuthenticated } = useApp();
  const { colors } = useTheme();
  const [mode, setMode] = useState<Mode>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [echoCode, setEchoCode] = useState<string | null>(null);
  const [maskedTarget, setMaskedTarget] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          flex: 1,
          backgroundColor: colors.authBg,
        },
        top: {
          flex: 1,
          paddingHorizontal: 24,
        },
        topRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        },
        backBtn: {
          paddingVertical: 8,
        },
        scroll: {
          paddingBottom: spacing.xl,
        },
        title: {
          fontFamily: fonts.sansBold,
          fontSize: 28,
          lineHeight: 34,
          letterSpacing: -0.4,
          color: colors.heading,
          marginBottom: 10,
        },
        sub: {
          fontFamily: fonts.sans,
          fontSize: 15,
          lineHeight: 22,
          color: colors.subtext,
          marginBottom: 28,
        },
        fieldRow: {
          flexDirection: 'row',
          gap: 12,
        },
        countryCol: {
          width: 118,
        },
        phoneCol: {
          flex: 1,
        },
        label: {
          fontFamily: fonts.sansSemi,
          fontSize: 14,
          color: colors.heading,
          marginBottom: 8,
        },
        field: {
          backgroundColor: colors.inputBg,
          borderRadius: 10,
          minHeight: 52,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        fullField: {
          width: '100%',
        },
        fieldText: {
          fontFamily: fonts.sans,
          fontSize: 16,
          color: colors.inputText,
        },
        input: {
          fontFamily: fonts.sans,
          fontSize: 16,
          color: colors.inputText,
          paddingVertical: Platform.OS === 'ios' ? 14 : 10,
        },
        codeBlock: {
          marginTop: 20,
        },
        hint: {
          marginTop: 8,
          fontFamily: fonts.sans,
          fontSize: 13,
          color: colors.subtext,
        },
        error: {
          marginTop: 12,
          fontFamily: fonts.sans,
          fontSize: 14,
          color: '#B42318',
        },
        altLink: {
          marginTop: 22,
          alignSelf: 'flex-start',
        },
        altLinkText: {
          fontFamily: fonts.sansSemi,
          fontSize: 15,
          color: colors.heading,
          textDecorationLine: 'underline',
        },
        footer: {
          paddingHorizontal: 24,
          paddingTop: 8,
        },
        cta: {
          height: 56,
          borderRadius: 999,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
        },
        ctaDisabled: {
          opacity: 0.6,
        },
        ctaLabel: {
          color: '#fff',
          fontFamily: fonts.sansBold,
          fontSize: 17,
        },
      }),
    [colors],
  );

  const requestCode = async () => {
    setError(null);
    setInfo(null);
    if (mode === 'phone') {
      if (!isValidPhoneInput(phone)) {
        setError('Enter a valid Kenyan mobile number (e.g. 798 278 006).');
        return;
      }
    } else if (!email.trim().includes('@')) {
      setError('Enter a valid email address.');
      return;
    }

    setBusy(true);
    try {
      const body =
        mode === 'email'
          ? { email: email.trim().toLowerCase() }
          : { phone: normalizePhone(phone) };
      const data = await requestLoginCode(body);
      setEchoCode(data.login_code);
      setMaskedTarget(
        mode === 'email' ? data.email_masked ?? email.trim() : data.phone_masked,
      );
      setInfo(data.message);
      setSent(true);
      if (data.login_code) {
        setCode(data.login_code);
      } else {
        setCode('');
        if (mode === 'phone' && !data.login_code) {
          setInfo(
            data.message ||
              'If this phone is onboarded, a login code will appear here.',
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send code');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const body =
        mode === 'email'
          ? { email: email.trim().toLowerCase(), code: code.trim() }
          : { phone: normalizePhone(phone), code: code.trim() };
      const me = await verifyLoginCode(body);
      onAuthenticated(me);
      if (me.active_trip_id && me.active_trip_phase) {
        router.replace(tripHref(me.active_trip_phase, me.active_trip_id) as never);
      } else {
        router.replace('/(tabs)/home');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify code');
    } finally {
      setBusy(false);
    }
  };

  const onContinue = () => {
    if (busy) return;
    if (!sent) {
      void requestCode();
      return;
    }
    void verify();
  };

  const switchToEmail = () => {
    setMode('email');
    setSent(false);
    setCode('');
    setEchoCode(null);
    setError(null);
    setInfo(null);
  };

  const switchToPhone = () => {
    setMode('phone');
    setSent(false);
    setCode('');
    setEchoCode(null);
    setError(null);
    setInfo(null);
  };

  const canSubmit = sent
    ? code.trim().length >= 6
    : mode === 'phone'
      ? isValidPhoneInput(phone)
      : email.trim().includes('@');

  const ctaLabel = !sent ? 'Send code' : 'Verify';

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <View style={styles.topRow}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
            hitSlop={12}
            style={styles.backBtn}
          >
            <Ionicons name="arrow-back" size={24} color={colors.heading} />
          </Pressable>
          <ThemeToggle />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {mode === 'phone' ? (
            <>
              <Text style={styles.title}>Let&apos;s start with your phone number</Text>
              <Text style={styles.sub}>
                Enter your 9-digit Safaricom/Airtel number (country is +254). Example:
                798278006. Only onboarded riders can sign in.
              </Text>

              <View style={styles.fieldRow}>
                <View style={styles.countryCol}>
                  <Text style={styles.label}>Country</Text>
                  <Pressable style={styles.field}>
                    <Text style={styles.fieldText}>+254 (KE)</Text>
                    <Ionicons name="chevron-down" size={16} color={colors.heading} />
                  </Pressable>
                </View>
                <View style={styles.phoneCol}>
                  <Text style={styles.label}>Phone</Text>
                  <TextInput
                    style={[styles.field, styles.input]}
                    placeholder="798278006"
                    placeholderTextColor={colors.placeholder}
                    keyboardType="phone-pad"
                    value={phone}
                    onChangeText={setPhone}
                    editable={!busy}
                    autoComplete="tel"
                  />
                </View>
              </View>
              {!sent ? (
                <Text style={styles.hint}>We&apos;ll show a one-time code on the next step.</Text>
              ) : null}

              {sent ? (
                <View style={styles.codeBlock}>
                  <Text style={styles.label}>Verification code</Text>
                  <TextInput
                    style={[styles.field, styles.input, styles.fullField]}
                    placeholder="123456"
                    placeholderTextColor={colors.placeholder}
                    keyboardType="number-pad"
                    value={code}
                    onChangeText={setCode}
                    editable={!busy}
                  />
                  {echoCode ? (
                    <Text style={styles.hint}>Dev code: {echoCode}</Text>
                  ) : maskedTarget ? (
                    <Text style={styles.hint}>Sent to {maskedTarget}</Text>
                  ) : null}
                  {info ? <Text style={styles.hint}>{info}</Text> : null}
                </View>
              ) : null}

              <Pressable onPress={switchToEmail} hitSlop={8} style={styles.altLink}>
                <Text style={styles.altLinkText}>Log in with email</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.title}>Log in with email</Text>
              <Text style={styles.sub}>
                Use the email linked to your DukAI Rider account. We&apos;ll send a one-time code.
              </Text>

              <Text style={styles.label}>Email</Text>
              <TextInput
                style={[styles.field, styles.input, styles.fullField]}
                placeholder="you@example.com"
                placeholderTextColor={colors.placeholder}
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
                editable={!busy}
              />

              {sent ? (
                <View style={styles.codeBlock}>
                  <Text style={styles.label}>Verification code</Text>
                  <TextInput
                    style={[styles.field, styles.input, styles.fullField]}
                    placeholder="123456"
                    placeholderTextColor={colors.placeholder}
                    keyboardType="number-pad"
                    value={code}
                    onChangeText={setCode}
                    editable={!busy}
                  />
                  {echoCode ? (
                    <Text style={styles.hint}>Dev code: {echoCode}</Text>
                  ) : maskedTarget ? (
                    <Text style={styles.hint}>Sent to {maskedTarget}</Text>
                  ) : null}
                </View>
              ) : null}

              <Pressable onPress={switchToPhone} hitSlop={8} style={styles.altLink}>
                <Text style={styles.altLinkText}>Use phone number instead</Text>
              </Pressable>
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </View>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Pressable
          onPress={onContinue}
          disabled={busy || !canSubmit}
          style={({ pressed }) => [
            styles.cta,
            (busy || !canSubmit) && styles.ctaDisabled,
            pressed && { opacity: 0.9 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaLabel}>{ctaLabel}</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
