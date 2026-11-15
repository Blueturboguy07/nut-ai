import { Redirect } from 'expo-router'

/**
 * expo-router's built-in sitemap is a developer page. This app has none: the
 * sitemap address goes to the start, like any other unknown link
 * (app/+not-found.tsx).
 */
export default function Sitemap() {
  return <Redirect href={'/' as never} />
}
