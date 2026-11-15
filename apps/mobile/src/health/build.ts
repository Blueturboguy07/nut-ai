import Constants from 'expo-constants'
import { Platform } from 'react-native'

/**
 * Is HealthKit compiled into this build?
 *
 * HealthKit is OFF unless the build ran with SKIP_HEALTHKIT=0 (app.config.ts
 * writes `extra.healthKit`; react-native.config.js does not link the library
 * when it is off). When it is off, the app shows NO Apple Health screen, row
 * or onboarding step (App Store 2.1: no feature that cannot work).
 */
export const HEALTHKIT_IN_BUILD: boolean =
  Platform.OS === 'ios' && (Constants.expoConfig?.extra as { healthKit?: unknown } | undefined)?.healthKit === true
