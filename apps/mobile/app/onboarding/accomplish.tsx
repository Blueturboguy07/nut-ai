import { OptionScreen } from '../../src/components/onboarding/OptionScreen'

export default function AccomplishScreen() {
  return (
    <OptionScreen
      step="accomplish"
      field="accomplish"
      title="What would you like to accomplish?"
      // Saved only: Home does not read todayEmphasisFor() yet, so no subtitle
      // promises an effect (App Store 2.1, Nov 14 2026).
      options={[
        { value: 'healthier', label: 'Eat and live healthier', glyph: 'apple' },
        { value: 'energy', label: 'Boost my energy and mood', glyph: 'sun' },
        { value: 'motivated', label: 'Stay motivated and consistent', glyph: 'muscle' },
        { value: 'body_image', label: 'Feel better about my body', glyph: 'lotus' },
      ]}
      scroll
    />
  )
}
