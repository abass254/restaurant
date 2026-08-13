import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PrimaryButton } from '@/src/components/PrimaryButton';
import type { TripItem } from '@/src/api';
import { useTheme } from '@/src/ThemeContext';
import { fonts, radius, spacing } from '@/src/theme';

type Props = {
  title: string;
  subtitle?: string;
  items: TripItem[];
  /** Apply a scanned code; parent updates items.checked */
  onScan: (code: string) => { ok: boolean; message: string };
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  scannedLabel?: string;
  pendingLabel?: string;
};

/** Camera in top ~1/4, live item checklist below (updates as barcodes match). */
export function ItemScanScreen({
  title,
  subtitle,
  items,
  onScan,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  scannedLabel = 'Scanned',
  pendingLabel = 'Still to scan',
}: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { colors, shadow } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackOk, setFeedbackOk] = useState(true);
  const [manual, setManual] = useState('');
  const lockRef = useRef(false);

  const cameraHeight = Math.max(140, Math.round(height * 0.25));
  const pending = useMemo(() => items.filter((i) => !i.checked), [items]);
  const scanned = useMemo(() => items.filter((i) => i.checked), [items]);
  const scannedCount = scanned.length;
  const total = items.length;

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  const applyCode = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code || lockRef.current) return;
      lockRef.current = true;
      const result = onScan(code);
      setFeedback(result.message);
      setFeedbackOk(result.ok);
      try {
        if (result.ok) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      } catch {
        // optional
      }
      setTimeout(() => {
        lockRef.current = false;
        if (result.ok) setFeedback(null);
      }, result.ok ? 900 : 1400);
    },
    [onScan],
  );

  const onBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      void applyCode(result.data);
    },
    [applyCode],
  );

  const showCamera = Platform.OS !== 'web' && permission?.granted;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: colors.bg },
        cameraBand: {
          height: cameraHeight,
          backgroundColor: '#0B0C0A',
          overflow: 'hidden',
        },
        camera: { flex: 1 },
        frame: {
          ...StyleSheet.absoluteFill,
          alignItems: 'center',
          justifyContent: 'center',
        },
        frameBox: {
          width: '78%',
          height: '58%',
          borderWidth: 2,
          borderColor: 'rgba(255,255,255,0.65)',
          borderRadius: radius.lg,
        },
        permission: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: spacing.xl,
          gap: spacing.sm,
        },
        permissionText: {
          fontFamily: fonts.sans,
          fontSize: 13,
          color: 'rgba(245,242,236,0.78)',
          textAlign: 'center',
          lineHeight: 18,
        },
        allowBtn: {
          marginTop: 4,
          backgroundColor: colors.primary,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: radius.cta,
        },
        allowLabel: {
          fontFamily: fonts.sansSemi,
          color: '#fff',
          fontSize: 13,
        },
        sheet: {
          flex: 1,
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius.xxl,
          borderTopRightRadius: radius.xxl,
          marginTop: -18,
          paddingHorizontal: spacing.xl,
          paddingTop: spacing.lg,
          ...shadow.lift,
        },
        title: {
          fontFamily: fonts.display,
          fontSize: 26,
          color: colors.text,
        },
        sub: {
          fontFamily: fonts.sans,
          fontSize: 14,
          color: colors.muted,
          marginTop: 4,
          lineHeight: 20,
        },
        progressRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: spacing.md,
          marginBottom: spacing.sm,
        },
        progressText: {
          fontFamily: fonts.sansSemi,
          fontSize: 14,
          color: colors.text,
        },
        progressPill: {
          backgroundColor: colors.primarySoft,
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: radius.cta,
        },
        progressPillText: {
          fontFamily: fonts.sansSemi,
          fontSize: 12,
          color: colors.primary,
        },
        feedback: {
          fontFamily: fonts.sansSemi,
          fontSize: 13,
          marginBottom: spacing.sm,
        },
        section: {
          fontFamily: fonts.sansSemi,
          fontSize: 12,
          color: colors.muted,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          marginTop: spacing.sm,
          marginBottom: 4,
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingVertical: spacing.sm + 2,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
        meta: { flex: 1, gap: 2 },
        name: {
          fontFamily: fonts.sansSemi,
          fontSize: 15,
          color: colors.text,
        },
        nameDone: {
          color: colors.muted,
          textDecorationLine: 'line-through',
        },
        code: {
          fontFamily: fonts.sans,
          fontSize: 12,
          color: colors.muted,
        },
        badge: {
          fontFamily: fonts.sansSemi,
          fontSize: 11,
          color: colors.success,
        },
        empty: {
          fontFamily: fonts.sans,
          fontSize: 13,
          color: colors.muted,
          paddingVertical: spacing.sm,
        },
        demo: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
          marginTop: spacing.sm,
        },
        demoChip: {
          backgroundColor: colors.surfaceMuted,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: radius.cta,
        },
        demoText: {
          fontFamily: fonts.sans,
          fontSize: 12,
          color: colors.text,
        },
        manualRow: {
          flexDirection: 'row',
          gap: spacing.sm,
          marginTop: spacing.md,
        },
        input: {
          flex: 1,
          height: 44,
          borderRadius: radius.lg,
          backgroundColor: colors.surfaceMuted,
          paddingHorizontal: 14,
          color: colors.text,
          fontFamily: fonts.sans,
        },
        enterBtn: {
          height: 44,
          paddingHorizontal: 14,
          borderRadius: radius.lg,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.primary,
        },
        enterLabel: {
          fontFamily: fonts.sansSemi,
          color: '#fff',
          fontSize: 13,
        },
        footer: {
          paddingTop: spacing.md,
          paddingBottom: Math.max(insets.bottom, spacing.md),
        },
      }),
    [cameraHeight, colors, insets.bottom, shadow.lift],
  );

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={[styles.cameraBand, { paddingTop: insets.top }]}>
        {showCamera ? (
          <>
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: [
                  'qr',
                  'ean13',
                  'ean8',
                  'code128',
                  'code39',
                  'upc_a',
                  'upc_e',
                ],
              }}
              onBarcodeScanned={onBarcodeScanned}
            />
            <View style={styles.frame} pointerEvents="none">
              <View style={styles.frameBox} />
            </View>
          </>
        ) : (
          <View style={styles.permission}>
            <Ionicons name="scan-outline" size={28} color="rgba(245,242,236,0.7)" />
            <Text style={styles.permissionText}>
              {Platform.OS === 'web'
                ? 'Use demo chips or enter a code below to scan on web.'
                : permission?.granted === false
                  ? 'Camera access is needed to scan barcodes.'
                  : 'Requesting camera…'}
            </Text>
            {permission && !permission.granted ? (
              <Pressable style={styles.allowBtn} onPress={() => void requestPermission()}>
                <Text style={styles.allowLabel}>Allow camera</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>

      <View style={styles.sheet}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}

        <View style={styles.progressRow}>
          <Text style={styles.progressText}>
            {scannedCount === total
              ? 'All items scanned'
              : `Scan products with the camera`}
          </Text>
          <View style={styles.progressPill}>
            <Text style={styles.progressPillText}>
              {scannedCount}/{total} scanned
            </Text>
          </View>
        </View>

        {feedback ? (
          <Text
            style={[
              styles.feedback,
              { color: feedbackOk ? colors.success : colors.danger },
            ]}
          >
            {feedback}
          </Text>
        ) : null}

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: spacing.md }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.section}>{pendingLabel}</Text>
          {pending.length === 0 ? (
            <Text style={styles.empty}>Nothing left — you&apos;re clear to continue.</Text>
          ) : (
            pending.map((item) => (
              <View key={item.id} style={styles.row}>
                <Ionicons name="scan-outline" size={22} color={colors.muted} />
                <View style={styles.meta}>
                  <Text style={styles.name}>
                    {item.qty}× {item.name}
                  </Text>
                  <Text style={styles.code}>{item.barcode}</Text>
                </View>
              </View>
            ))
          )}

          <Text style={styles.section}>{scannedLabel}</Text>
          {scanned.length === 0 ? (
            <Text style={styles.empty}>Scanned items will appear here.</Text>
          ) : (
            scanned.map((item) => (
              <View key={item.id} style={styles.row}>
                <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                <View style={styles.meta}>
                  <Text style={[styles.name, styles.nameDone]}>
                    {item.qty}× {item.name}
                  </Text>
                  <Text style={styles.code}>{item.barcode}</Text>
                </View>
                <Text style={styles.badge}>Done</Text>
              </View>
            ))
          )}

          {pending.length > 0 ? (
            <>
              <Text style={[styles.section, { marginTop: spacing.md }]}>Demo scan</Text>
              <View style={styles.demo}>
                {pending.map((p) => (
                  <Pressable
                    key={p.barcode}
                    style={styles.demoChip}
                    onPress={() => void applyCode(p.barcode)}
                  >
                    <Text style={styles.demoText}>{p.name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          <View style={styles.manualRow}>
            <TextInput
              style={styles.input}
              value={manual}
              onChangeText={setManual}
              placeholder="Enter barcode"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              onSubmitEditing={() => {
                void applyCode(manual);
                setManual('');
              }}
            />
            <Pressable
              style={styles.enterBtn}
              onPress={() => {
                void applyCode(manual);
                setManual('');
              }}
            >
              <Text style={styles.enterLabel}>Enter</Text>
            </Pressable>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton
            label={primaryLabel}
            onPress={onPrimary}
            disabled={primaryDisabled}
          />
        </View>
      </View>
    </View>
  );
}
