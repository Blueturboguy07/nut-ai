const fs = require('fs')
const path = require('path')
const { withAndroidColors, withDangerousMod, withInfoPlist } = require('@expo/config-plugins')

/**
 * The launch screen in the app's colours: the app mark (assets/launch-mark.png,
 * the icon at 360 px, shown at 120 pt) on the icon's near-black, #0B0B0F.
 *
 * Blind test round 2 (Nov 15 2026, N9): a cold start showed a plain white
 * screen for 6-9 s. The Expo template's launch storyboard is white with no
 * image (expo-splash-screen is not in this app), and the first React screen
 * waited for the publik sign-in check. This plugin writes the launch
 * storyboard and its image on every prebuild (prebuild --clean regenerates
 * ios/), and src/components/LaunchScreen.tsx shows the same picture in React
 * until the first screen is ready, so the start is one dark screen, not white.
 * Android: the same colour for the splash background.
 */
const BACKGROUND = '#0B0B0F'
const MARK = path.join(__dirname, '..', 'assets', 'launch-mark.png')

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255).toFixed(3))
}

function storyboard() {
  const [r, g, b] = rgb(BACKGROUND)
  return `<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="24093.7" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="NUTAI-LAUNCH-VC">
    <device id="retina6_12" orientation="portrait" appearance="light"/>
    <dependencies>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="24053.1"/>
        <capability name="Safe area layout guides" minToolsVersion="9.0"/>
        <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
    </dependencies>
    <scenes>
        <scene sceneID="NUTAI-LAUNCH-SCENE">
            <objects>
                <viewController storyboardIdentifier="SplashScreenViewController" id="NUTAI-LAUNCH-VC" sceneMemberID="viewController">
                    <view key="view" userInteractionEnabled="NO" contentMode="scaleToFill" insetsLayoutMarginsFromSafeArea="NO" id="NUTAI-LAUNCH-VIEW">
                        <rect key="frame" x="0.0" y="0.0" width="393" height="852"/>
                        <autoresizingMask key="autoresizingMask" flexibleMaxX="YES" flexibleMaxY="YES"/>
                        <subviews>
                            <imageView clipsSubviews="YES" userInteractionEnabled="NO" contentMode="scaleAspectFit" image="LaunchMark" translatesAutoresizingMaskIntoConstraints="NO" id="NUTAI-LAUNCH-MARK">
                                <rect key="frame" x="136.5" y="366" width="120" height="120"/>
                                <constraints>
                                    <constraint firstAttribute="width" constant="120" id="NUTAI-LAUNCH-W"/>
                                    <constraint firstAttribute="height" constant="120" id="NUTAI-LAUNCH-H"/>
                                </constraints>
                            </imageView>
                        </subviews>
                        <viewLayoutGuide key="safeArea" id="NUTAI-LAUNCH-SAFE"/>
                        <constraints>
                            <constraint firstItem="NUTAI-LAUNCH-MARK" firstAttribute="centerX" secondItem="NUTAI-LAUNCH-VIEW" secondAttribute="centerX" id="NUTAI-LAUNCH-CX"/>
                            <constraint firstItem="NUTAI-LAUNCH-MARK" firstAttribute="centerY" secondItem="NUTAI-LAUNCH-VIEW" secondAttribute="centerY" id="NUTAI-LAUNCH-CY"/>
                        </constraints>
                        <color key="backgroundColor" red="${r}" green="${g}" blue="${b}" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="NUTAI-LAUNCH-FR" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
            <point key="canvasLocation" x="0.0" y="0.0"/>
        </scene>
    </scenes>
    <resources>
        <image name="LaunchMark" width="120" height="120"/>
    </resources>
</document>
`
}

function withIosLaunchScreen(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UILaunchStoryboardName = 'SplashScreen'
    return cfg
  })
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, cfg.modRequest.projectName)
      fs.writeFileSync(path.join(dir, 'SplashScreen.storyboard'), storyboard())
      const set = path.join(dir, 'Images.xcassets', 'LaunchMark.imageset')
      fs.mkdirSync(set, { recursive: true })
      fs.copyFileSync(MARK, path.join(set, 'LaunchMark.png'))
      fs.writeFileSync(
        path.join(set, 'Contents.json'),
        JSON.stringify(
          {
            images: [{ idiom: 'universal', filename: 'LaunchMark.png', scale: '3x' }],
            info: { author: 'xcode', version: 1 },
          },
          null,
          2,
        ),
      )
      return cfg
    },
  ])
}

function withAndroidLaunchColour(config) {
  return withAndroidColors(config, (cfg) => {
    const colors = cfg.modResults.resources.color ?? []
    const set = (name) => {
      const found = colors.find((c) => c.$.name === name)
      if (found) found._ = BACKGROUND
      else colors.push({ $: { name }, _: BACKGROUND })
    }
    set('splashscreen_background')
    cfg.modResults.resources.color = colors
    return cfg
  })
}

module.exports = function withLaunchScreen(config) {
  return withAndroidLaunchColour(withIosLaunchScreen(config))
}
module.exports.LAUNCH_BACKGROUND = BACKGROUND
