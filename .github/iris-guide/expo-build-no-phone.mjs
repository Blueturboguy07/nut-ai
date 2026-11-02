#!/usr/bin/env node
/**
 * Stands in for the last line of the guide's run-android step,
 * `npx.cmd expo run:android --variant release --no-bundler`, on a CI runner.
 * The runner has no phone or emulator, so expo itself stops at the device
 * lookup, before it builds anything. This file calls @expo/cli's own functions
 * in the order and with the values runAndroidAsync uses for that command
 * (@expo/cli 57.0.11, build/src/run/android/runAndroidAsync.js):
 *   1. setNodeEnv('production') and loadEnvFiles(projectRoot): the variant
 *      ends in 'release'.
 *   2. exportEagerAsync(projectRoot, { dev: false, platform: 'android' }): the
 *      JS bundle, before Gradle (resetCache is !CI, so CI phases that want a
 *      reader's timing remove the CI variable).
 *   3. assembleAsync(<projectRoot>/android, { variant: 'release', port: 8081,
 *      appName: 'app', buildCache: true, architectures: '',
 *      eagerBundleOptions }): the Gradle run, with expo's own arguments and
 *      environment. port 8081: resolveBundlerPropsAsync with --no-bundler.
 *      buildCache: true unless --no-build-cache. architectures '':
 *      getConnectedDeviceABI returns '' for every non-debug build.
 * Left out, because they need a phone: the device lookup, the APK install,
 * the app launch and the headless Metro start and stop around the launch.
 *
 * Usage (working directory = apps/mobile, as in the guide step):
 *   node expo-build-no-phone.mjs
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'

const projectRoot = process.cwd()
// Resolve @expo/cli from the expo package, as `npx expo` does.
const fromProject = createRequire(join(projectRoot, 'package.json'))
const fromExpo = createRequire(fromProject.resolve('expo/package.json'))
const { version } = fromExpo('@expo/cli/package.json')
if (version !== '57.0.11') {
  console.error(`expo-build-no-phone.mjs copies @expo/cli 57.0.11; this project has ${version}. Read runAndroidAsync again.`)
  process.exit(1)
}
const cli = (path) => fromExpo(`@expo/cli/build/src/${path}`)
const { setNodeEnv, loadEnvFiles } = cli('utils/nodeEnv')
const { exportEagerAsync } = cli('export/embed/exportEager')
const { assembleAsync } = cli('start/platforms/android/gradle')

const started = Date.now()
const seconds = () => ((Date.now() - started) / 1000).toFixed(1)
setNodeEnv('production')
loadEnvFiles(projectRoot)
console.log('› Building app...')
const eagerBundleOptions = JSON.stringify(await exportEagerAsync(projectRoot, { dev: false, platform: 'android' }))
console.log(`--- expo's eager JS export ended at ${seconds()} s; Gradle starts now`)
await assembleAsync(join(projectRoot, 'android'), {
  variant: 'release',
  port: 8081,
  appName: 'app',
  buildCache: true,
  architectures: '',
  eagerBundleOptions,
})
console.log(`--- expo's Gradle run ended at ${seconds()} s (install and launch need a phone: not run here)`)
