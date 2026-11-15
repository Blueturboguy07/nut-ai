import { OptionScreen } from '../../src/components/onboarding/OptionScreen'

export default function BlockerScreen() {
  return (
    <OptionScreen
      step="blocker"
      field="blocker"
      title="What's stopping you from reaching your goals?"
      // Saved only: the settings featureDefaultsFor() writes are not read by
      // any screen yet, so no subtitle promises an effect (App Store 2.1).
      options={[
        { value: 'consistency', label: 'Lack of consistency', glyph: 'bars' },
        { value: 'eating_habits', label: 'Unhealthy eating habits', glyph: 'burger' },
        { value: 'support', label: 'Lack of support', glyph: 'handshake' },
        { value: 'busy', label: 'Busy schedule', glyph: 'calendar' },
        { value: 'meal_inspiration', label: 'Lack of meal inspiration', glyph: 'apple' },
      ]}
      scroll
    />
  )
}
