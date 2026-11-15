import { CameraView, useCameraPermissions } from 'expo-camera'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, type IconName } from '../src/components/Icon'
import { startBarcodeScan, startLabelScan, startReceiptScan, startScan } from '../src/scan/orchestrator'
import { pickMealPhoto } from '../src/scan/pick-photo'
import { setPhase } from '../src/scan/store'
import { useTheme } from '../src/theme/ThemeProvider'
import { APP_NAME } from '../src/inference/publik-copy'
import { MIN_TAP_TARGET, radius, space, tap, type } from '../src/theme/tokens'

type CameraMode = 'food' | 'barcode' | 'label' | 'receipt'

const MODES: Array<{ id: CameraMode; label: string; icon: IconName }> = [
  { id: 'food', label: 'Scan food', icon: 'scan' },
  { id: 'barcode', label: 'Barcode', icon: 'barcode' },
  { id: 'label', label: 'Label', icon: 'nutritionLabel' },
  { id: 'receipt', label: 'Receipt', icon: 'receipt' },
]

/**
 * Capture.
 *
 * SPEC-accuracy-engine.md §1.1 stages 0 and 1.
 *
 * THE SHUTTER ALWAYS SUCCEEDS. It writes a draft row before anything else can
 * fail — no key, no network, no model, no permission to analyze. A capture that
 * fails because the network is down loses the user's meal, and losing a meal is
 * unrecoverable in a way that a wrong number never is.
 *
 * Everything after the shutter — preprocessing, the model call, the pipeline —
 * lives in src/scan/orchestrator.ts and runs behind the result screen's
 * progress states. This screen's whole job is to hand off and get out of the
 * way fast.
 *
 * NO CAMERA NEEDED (blind test round 1, Nov 14 2026): "Choose a photo" (the
 * photo library) and "Describe a meal" (text) sit next to the shutter, and on
 * the screen without camera access. A simulator, a phone whose camera cannot
 * be used, and App Review can still get an estimate.
 */
export default function Camera() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef<CameraView>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<CameraMode>('food')
  // Barcode frames arrive continuously; only the FIRST detection may fire.
  const barcodeFired = useRef(false)

  if (!permission) return <View style={{ flex: 1, backgroundColor: '#000' }} />

  /** A library photo goes through the same scan as a camera photo, in the mode that is on. */
  async function choosePhoto() {
    if (busy) return
    setBusy(true)
    try {
      const uri = await pickMealPhoto().catch(() => null)
      if (!uri) return
      setPhase({ kind: 'captured', photoUri: uri })
      router.replace('/result')
      if (mode === 'label') void startLabelScan(uri)
      else if (mode === 'receipt') void startReceiptScan(uri)
      else void startScan(uri)
    } finally {
      setBusy(false)
    }
  }

  function describeMeal() {
    router.replace('/describe-meal' as never)
  }

  if (!permission.granted) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        <Text style={[type.heading, { color: theme.text, textAlign: 'center' }]}>
          {APP_NAME} needs your camera
        </Text>
        <Text style={[type.caption, { color: theme.textMuted, textAlign: 'center', marginTop: space.sm }]}>
          Photos stay on your device unless you chose a cloud provider during setup.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={requestPermission}
          style={[styles.primary, { backgroundColor: theme.text, marginTop: space.xl }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg }]}>Allow camera</Text>
        </Pressable>
        <Text style={[type.caption, { color: theme.textMuted, textAlign: 'center', marginTop: space.xl }]}>
          No camera? Use a photo you took, or say what you ate.
        </Text>
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
          <Pressable
            accessibilityRole="button"
            onPress={choosePhoto}
            disabled={busy}
            style={[styles.secondary, { borderColor: theme.border }]}
          >
            <Icon name="image" size={18} color={theme.text} />
            <Text style={[type.label, { color: theme.text }]}>Choose a photo</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={describeMeal}
            style={[styles.secondary, { borderColor: theme.border }]}
          >
            <Icon name="pencil" size={18} color={theme.text} />
            <Text style={[type.label, { color: theme.text }]}>Describe a meal</Text>
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={[tap, { marginTop: space.lg }]}>
          <Text style={[type.body, { color: theme.textMuted }]}>Not now</Text>
        </Pressable>
      </View>
    )
  }

  async function capture() {
    if (busy) return
    setBusy(true)
    try {
      const shot = await cameraRef.current?.takePictureAsync({ quality: 1, skipProcessing: false })
      if (!shot?.uri) return

      // The draft exists from this moment. Everything after can fail safely.
      setPhase({ kind: 'captured', photoUri: shot.uri })

      // Navigate NOW. Preprocessing, the model call and the pipeline all run
      // behind the result screen's progress states — the user never stares at
      // a frozen viewfinder wondering whether the shutter worked.
      router.replace('/result')
      if (mode === 'label') void startLabelScan(shot.uri)
      else if (mode === 'receipt') void startReceiptScan(shot.uri)
      else void startScan(shot.uri)
    } finally {
      setBusy(false)
    }
  }

  function onBarcode(data: string) {
    if (barcodeFired.current || !data) return
    barcodeFired.current = true
    router.replace('/result')
    void startBarcodeScan(data)
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
        onBarcodeScanned={mode === 'barcode' ? ({ data }) => onBarcode(data) : undefined}
      />

      <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, space.xl) }]}>
        {/* No camera needed: a library photo, or the meal in words. */}
        <View style={styles.altRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose a photo"
            onPress={choosePhoto}
            disabled={busy}
            style={styles.altPill}
          >
            <Icon name="image" size={18} color="#fff" />
            <Text style={[type.label, { color: '#fff' }]}>Choose a photo</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Describe a meal"
            onPress={describeMeal}
            style={styles.altPill}
          >
            <Icon name="pencil" size={18} color="#fff" />
            <Text style={[type.label, { color: '#fff' }]}>Describe a meal</Text>
          </Pressable>
        </View>
        <View style={styles.modeRow}>
          {MODES.map((m) => {
            const active = mode === m.id
            return (
              <Pressable
                key={m.id}
                accessibilityRole="button"
                accessibilityLabel={m.label}
                onPress={() => {
                  barcodeFired.current = false
                  setMode(m.id)
                }}
                style={[styles.modePill, active && styles.modePillActive]}
              >
                <Icon name={m.icon} size={18} color={active ? '#000' : '#fff'} />
                <Text style={[type.label, { color: active ? '#000' : '#fff' }]}>{m.label}</Text>
              </Pressable>
            )
          })}
        </View>

        {mode === 'barcode' ? (
          <Text style={[type.caption, styles.hint]}>Point at the barcode — it scans on its own</Text>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            onPress={capture}
            disabled={busy}
            style={[styles.shutter, busy && { opacity: 0.5 }]}
          />
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={() => router.back()}
        style={[styles.close, { top: insets.top + space.md }]}
      >
        <Text style={{ color: '#fff', fontSize: 22 }}>×</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  primary: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    minHeight: MIN_TAP_TARGET,
    justifyContent: 'center',
  },
  controls: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: space.lg },
  // 2x2 — four pills in one row overflow both screen edges on every iPhone.
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    width: '47%',
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.45)',
    minHeight: MIN_TAP_TARGET,
  },
  modePillActive: { backgroundColor: '#fff' },
  altRow: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, alignSelf: 'stretch', justifyContent: 'center' },
  altPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    minHeight: MIN_TAP_TARGET,
  },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: MIN_TAP_TARGET,
  },
  hint: { color: 'rgba(255,255,255,0.85)', paddingVertical: space.lg },
  shutter: {
    width: 74,
    height: 74,
    borderRadius: radius.pill,
    backgroundColor: '#fff',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  close: {
    position: 'absolute',
    left: space.lg,
    width: MIN_TAP_TARGET,
    height: MIN_TAP_TARGET,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
