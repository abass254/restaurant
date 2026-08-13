import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/ThemeContext';
import { fonts, radius, spacing } from '@/src/theme';

type Props = {
  visible: boolean;
  title?: string;
  hint?: string;
  /** Expected codes still to scan — used for demo buttons. */
  pendingCodes?: Array<{ barcode: string; label: string }>;
  onClose: () => void;
  onScan: (code: string) => { ok: boolean; message: string };
};

export function BarcodeScanModal({
  visible,
  title = 'Scan barcode',
  hint = 'Align the product barcode in the frame',
  pendingCodes = [],
  onClose,
  onScan,
}: Props) {
  const insets = useSafeAreaInsets();
  const { colors, shadow } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackOk, setFeedbackOk] = useState(true);
  const [manual, setManual] = useState('');
  const lockRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      setFeedback(null);
      setManual('');
      lockRef.current = false;
      return;
    }
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [visible, permission, requestPermission]);

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
        // haptics optional
      }
      setTimeout(() => {
        lockRef.current = false;
        if (result.ok) setFeedback(null);
      }, result.ok ? 700 : 1200);
    },
    [onScan],
  );

  const onBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      void applyCode(result.data);
    },
    [applyCode],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          flex: 1,
          backgroundColor: '#0B0C0A',
        },
        top: {
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.md,
          gap: spacing.sm,
        },
        headerRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        title: {
          fontFamily: fonts.display,
          fontSize: 24,
          color: '#F5F2EC',
        },
        hint: {
          fontFamily: fonts.sans,
          fontSize: 14,
          color: 'rgba(245,242,236,0.72)',
          lineHeight: 20,
        },
        close: {
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(255,255,255,0.12)',
        },
        cameraWrap: {
          flex: 1,
          marginHorizontal: spacing.lg,
          borderRadius: radius.xxl,
          overflow: 'hidden',
          backgroundColor: '#1C1F19',
        },
        camera: { flex: 1 },
        frame: {
          ...StyleSheet.absoluteFill,
          alignItems: 'center',
          justifyContent: 'center',
        },
        frameBox: {
          width: '72%',
          aspectRatio: 1.4,
          borderWidth: 2,
          borderColor: 'rgba(255,255,255,0.55)',
          borderRadius: radius.lg,
        },
        permission: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: spacing.xl,
          gap: spacing.md,
        },
        permissionText: {
          fontFamily: fonts.sans,
          fontSize: 15,
          color: 'rgba(245,242,236,0.8)',
          textAlign: 'center',
          lineHeight: 22,
        },
        allowBtn: {
          marginTop: spacing.sm,
          backgroundColor: colors.primary,
          paddingHorizontal: 18,
          paddingVertical: 12,
          borderRadius: radius.cta,
        },
        allowLabel: {
          fontFamily: fonts.sansSemi,
          color: '#fff',
        },
        bottom: {
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
          gap: spacing.sm,
        },
        feedback: {
          fontFamily: fonts.sansSemi,
          fontSize: 14,
          textAlign: 'center',
        },
        manualRow: {
          flexDirection: 'row',
          gap: spacing.sm,
        },
        input: {
          flex: 1,
          height: 48,
          borderRadius: radius.lg,
          backgroundColor: 'rgba(255,255,255,0.1)',
          paddingHorizontal: 14,
          color: '#F5F2EC',
          fontFamily: fonts.sans,
        },
        enterBtn: {
          height: 48,
          paddingHorizontal: 16,
          borderRadius: radius.lg,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.primary,
        },
        enterLabel: {
          fontFamily: fonts.sansSemi,
          color: '#fff',
        },
        demo: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
        },
        demoChip: {
          backgroundColor: 'rgba(255,255,255,0.1)',
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: radius.cta,
          ...shadow.card,
        },
        demoText: {
          fontFamily: fonts.sans,
          fontSize: 12,
          color: 'rgba(245,242,236,0.85)',
        },
      }),
    [colors.primary, shadow.card],
  );

  const showCamera = Platform.OS !== 'web' && permission?.granted;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.top}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{title}</Text>
            <Pressable style={styles.close} onPress={onClose} accessibilityLabel="Close scanner">
              <Ionicons name="close" size={22} color="#F5F2EC" />
            </Pressable>
          </View>
          <Text style={styles.hint}>{hint}</Text>
        </View>

        <View style={styles.cameraWrap}>
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
              <Ionicons name="scan-outline" size={40} color="rgba(245,242,236,0.7)" />
              <Text style={styles.permissionText}>
                {Platform.OS === 'web'
                  ? 'Camera scanning works best on your phone. Enter a code below or use a demo chip.'
                  : permission?.granted === false
                    ? 'Camera access is needed to scan product barcodes.'
                    : 'Requesting camera access…'}
              </Text>
              {permission && !permission.granted ? (
                <Pressable style={styles.allowBtn} onPress={() => void requestPermission()}>
                  <Text style={styles.allowLabel}>Allow camera</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>

        <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.lg }]}>
          {feedback ? (
            <Text
              style={[
                styles.feedback,
                { color: feedbackOk ? '#A8B89A' : '#E07A6A' },
              ]}
            >
              {feedback}
            </Text>
          ) : null}

          <View style={styles.manualRow}>
            <TextInput
              style={styles.input}
              value={manual}
              onChangeText={setManual}
              placeholder="Enter barcode"
              placeholderTextColor="rgba(245,242,236,0.4)"
              autoCapitalize="characters"
              autoCorrect={false}
              onSubmitEditing={() => void applyCode(manual)}
            />
            <Pressable style={styles.enterBtn} onPress={() => void applyCode(manual)}>
              <Text style={styles.enterLabel}>Enter</Text>
            </Pressable>
          </View>

          {pendingCodes.length > 0 ? (
            <View style={styles.demo}>
              {pendingCodes.map((p) => (
                <Pressable
                  key={p.barcode}
                  style={styles.demoChip}
                  onPress={() => void applyCode(p.barcode)}
                >
                  <Text style={styles.demoText}>Demo: {p.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
