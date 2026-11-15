import { OptionScreen } from '../../src/components/onboarding/OptionScreen'

export default function DietScreen() {
  return (
    <OptionScreen
      step="diet"
      field="dietStyle"
      title="Do you follow a specific diet?"
      // Saved (Profile → Diet style). Food resolution does not read it yet, so
      // no subtitle promises that (App Store 2.1, Nov 14 2026).
      options={[
        { value: 'balanced', label: 'Balanced', glyph: 'scaleBalance' },
        { value: 'whole_food', label: 'Whole-food focus', glyph: 'bowl' },
        { value: 'mediterranean', label: 'Mediterranean', glyph: 'leaf' },
        { value: 'flexitarian', label: 'Flexitarian', glyph: 'meat' },
        { value: 'pescatarian', label: 'Pescatarian', glyph: 'fish' },
        { value: 'vegetarian', label: 'Vegetarian', glyph: 'sprout' },
        { value: 'vegan', label: 'Vegan', glyph: 'sprout' },
      ]}
      scroll
    />
  )
}
