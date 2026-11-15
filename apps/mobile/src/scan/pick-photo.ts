import * as ImagePicker from 'expo-image-picker'

/**
 * "Choose a photo": a meal photo the person already took, from the photo
 * library, for a phone whose camera cannot be used (a simulator, a broken
 * camera, App Review). The system photo picker shows only what the person
 * picks to the app, so it asks for no photo library permission. The photo
 * then goes through the same scan as a camera photo.
 *
 * Returns the picked photo's file URI, or null when the person cancels.
 */
export async function pickMealPhoto(): Promise<string | null> {
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    allowsMultipleSelection: false,
    quality: 1,
    exif: false,
  })
  if (r.canceled) return null
  return r.assets[0]?.uri ?? null
}
