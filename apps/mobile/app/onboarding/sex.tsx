import { OptionScreen } from '../../src/components/onboarding/OptionScreen'

export default function SexScreen() {
  return (
    <OptionScreen
      step="sex"
      field="sex"
      title="Choose your sex"
      subtitle="We use this only to calculate the calories your body uses at rest. That sets your calorie target."
      options={[
        { value: 'male', label: 'Male', glyph: 'male' },
        { value: 'female', label: 'Female', glyph: 'female' },
        { value: 'unspecified', label: 'Other', glyph: 'nonbinary' },
      ]}
    />
  )
}
