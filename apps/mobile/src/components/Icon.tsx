import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg'
import { useTheme } from '../theme/ThemeProvider'

/**
 * The icon set.
 *
 * Hand-drawn SVG paths on a 24×24 grid, replacing the emoji this app shipped
 * with first. Emoji are not an icon system: they render as full-colour bitmaps
 * that ignore the theme, shift shape between iOS versions, cannot take a stroke
 * weight, and sit at a baseline that never aligns with the text beside them. The
 * result reads as unfinished no matter how good the layout is, because the marks
 * themselves belong to a different design language than everything around them.
 *
 * These are stroke-based, inherit `color`, align on a shared optical grid, and
 * scale to any size without a second asset.
 */

export type IconName =
  | 'flame'
  | 'protein'
  | 'carbs'
  | 'fat'
  | 'fiber'
  | 'sugar'
  | 'sodium'
  | 'steps'
  | 'water'
  | 'home'
  | 'chart'
  | 'person'
  | 'scan'
  | 'barcode'
  | 'nutritionLabel'
  | 'receipt'
  | 'run'
  | 'search'
  | 'bookmark'
  | 'dumbbell'
  | 'scale'
  | 'male'
  | 'female'
  | 'nonbinary'
  | 'arrowUp'
  | 'arrowDown'
  | 'minus'
  | 'thumbUp'
  | 'thumbDown'
  | 'calendar'
  | 'handshake'
  | 'burger'
  | 'bars'
  | 'apple'
  | 'sun'
  | 'muscle'
  | 'lotus'
  | 'leaf'
  | 'fish'
  | 'meat'
  | 'scaleBalance'
  | 'bowl'
  | 'sprout'
  | 'check'
  | 'chevron'
  | 'plus'
  | 'close'
  | 'pencil'
  | 'image'
  | 'heart'
  | 'clock'
  | 'target'
  | 'dot1'
  | 'dot3'
  | 'dot6'

export interface IconProps {
  name: IconName
  size?: number
  color?: string
  /** Stroke weight. 1.8 is the default optical weight for this set. */
  weight?: number
}

export function Icon({ name, size = 24, color, weight = 1.8 }: IconProps) {
  const theme = useTheme()
  const c = color ?? theme.text
  const common: Common = {
    stroke: c,
    strokeWidth: weight,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    fill: 'none',
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {render(name, c, common)}
    </Svg>
  )
}

type Common = {
  stroke: string
  strokeWidth: number
  strokeLinecap: 'round'
  strokeLinejoin: 'round'
  fill: 'none'
}

function render(name: IconName, c: string, s: Common) {
  switch (name) {
    case 'flame':
      return (
        <Path
          {...s}
          d="M12 3c.6 2.5-.8 3.7-1.9 4.9C8.7 9.3 7 10.8 7 13.6A5 5 0 0 0 12 19a5 5 0 0 0 5-5.4c0-2.2-1-3.4-2.2-4.8-.6 1-1.2 1.4-1.9 1.6.5-2.6.1-5.5-.9-8.4Z"
        />
      )
    case 'protein':
      // A drumstick: meat mass plus the bone.
      return (
        <G>
          <Path {...s} d="M15.6 4.2a4.6 4.6 0 0 1 1.3 7.1l-5.5 5.5-3.9-3.9 5.5-5.5a4.6 4.6 0 0 1 2.6-3.2Z" />
          <Path {...s} d="m7.5 12.9-2.1 2.1a2 2 0 1 0 1.3 3.3 2 2 0 1 0 3.3 1.3l2.1-2.1" />
        </G>
      )
    case 'carbs':
      // A wheat sheaf.
      return (
        <G>
          <Path {...s} d="M12 21V9" />
          <Path {...s} d="M12 9c0-2 1.3-3.6 3-4 .3 1.9-.8 3.6-3 4Z" />
          <Path {...s} d="M12 9c0-2-1.3-3.6-3-4-.3 1.9.8 3.6 3 4Z" />
          <Path {...s} d="M12 14c0-2 1.3-3.6 3-4 .3 1.9-.8 3.6-3 4Z" />
          <Path {...s} d="M12 14c0-2-1.3-3.6-3-4-.3 1.9.8 3.6 3 4Z" />
        </G>
      )
    case 'fat':
      // A droplet.
      return <Path {...s} d="M12 3.5c3 3.6 5.5 6.3 5.5 9.3a5.5 5.5 0 0 1-11 0c0-3 2.5-5.7 5.5-9.3Z" />
    case 'fiber':
      return (
        <G>
          <Path {...s} d="M12 21c0-5 2.5-8.5 7-10-.5 5.5-3 9-7 10Z" />
          <Path {...s} d="M12 21c0-4-2-7-6-8.5.4 4.5 2.4 7.5 6 8.5Z" />
          <Path {...s} d="M12 21v-6" />
        </G>
      )
    case 'sugar':
      // A sugar cube in isometric.
      return (
        <G>
          <Path {...s} d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
          <Path {...s} d="m4 7 8 4 8-4M12 11v10" />
        </G>
      )
    case 'sodium':
      // A salt shaker.
      return (
        <G>
          <Path {...s} d="M8 21V10a4 4 0 0 1 8 0v11H8Z" />
          <Path {...s} d="M8 14h8" />
          <Circle cx="11" cy="6" r=".7" fill={c} stroke="none" />
          <Circle cx="13.5" cy="4.5" r=".7" fill={c} stroke="none" />
          <Circle cx="13" cy="7.5" r=".7" fill={c} stroke="none" />
        </G>
      )
    case 'steps':
      return (
        <G>
          <Ellipse {...s} cx="8" cy="9" rx="2.6" ry="4" />
          <Path {...s} d="M5.6 13.5c0 1.7.6 2.8 2.4 2.8s2.4-1.1 2.4-2.8" />
          <Ellipse {...s} cx="16" cy="14" rx="2.6" ry="4" />
          <Path {...s} d="M13.6 18.5c0 1.7.6 2.8 2.4 2.8s2.4-1.1 2.4-2.8" />
        </G>
      )
    case 'water':
      return (
        <G>
          <Path {...s} d="M6 4h12l-1.4 15.2a2 2 0 0 1-2 1.8H9.4a2 2 0 0 1-2-1.8L6 4Z" />
          <Path {...s} d="M6.7 11h10.6" />
        </G>
      )
    case 'home':
      return (
        <G>
          <Path {...s} d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19v-8.5Z" />
          <Path {...s} d="M9.5 20.5v-6h5v6" />
        </G>
      )
    case 'chart':
      return (
        <G>
          <Path {...s} d="M5 20V13" />
          <Path {...s} d="M12 20V6" />
          <Path {...s} d="M19 20v-9" />
        </G>
      )
    case 'person':
      return (
        <G>
          <Circle {...s} cx="12" cy="8" r="3.6" />
          <Path {...s} d="M4.8 20.2a7.4 7.4 0 0 1 14.4 0" />
        </G>
      )
    case 'scan':
      return (
        <G>
          <Path {...s} d="M3.5 8.5v-3a2 2 0 0 1 2-2h3M15.5 3.5h3a2 2 0 0 1 2 2v3M20.5 15.5v3a2 2 0 0 1-2 2h-3M8.5 20.5h-3a2 2 0 0 1-2-2v-3" />
          <Circle {...s} cx="12" cy="12" r="3.2" />
        </G>
      )
    case 'barcode':
      // Frame corners plus the bar pattern.
      return (
        <G>
          <Path {...s} d="M3.5 8v-2.5a2 2 0 0 1 2-2h2M16.5 3.5h2a2 2 0 0 1 2 2V8M20.5 16v2.5a2 2 0 0 1-2 2h-2M7.5 20.5h-2a2 2 0 0 1-2-2V16" />
          <Path {...s} d="M7.5 9v6M10.5 9v6M13.5 9v6M16.5 9v6" />
        </G>
      )
    case 'nutritionLabel':
      // A nutrition-facts panel: bordered card, heavy title bar, value lines.
      return (
        <G>
          <Rect {...s} x="5" y="3.5" width="14" height="17" rx="1.5" />
          <Path {...s} d="M8 7h8" strokeWidth={2.6} />
          <Path {...s} d="M8 11h8M8 14h8M8 17h5" />
        </G>
      )
    case 'run':
      // A running shoe in profile: sole line, upper curve, lace ticks.
      return (
        <G>
          <Path {...s} d="M3.5 16.5h17v1.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-1.5Z" />
          <Path {...s} d="M3.5 16.5c0-2.2 1.6-3.4 3.8-3.9l2.4-.6c.9-.2 1.6-.8 2-1.6l1-2.2 2.6 2.7c.7.7 1.6 1.2 2.6 1.4 1.5.3 2.6 1.1 2.6 2.7v1.5" />
          <Path {...s} d="m11 12.6 1.4 1.4M13.2 11l1.4 1.4" />
        </G>
      )
    case 'receipt':
      // A slip with a torn zigzag bottom and item lines.
      return (
        <G>
          <Path {...s} d="M6 3.5h12v15l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5v-15Z" />
          <Path {...s} d="M9 7.5h6M9 10.5h6M9 13.5h3.5" />
        </G>
      )
    case 'search':
      return (
        <G>
          <Circle {...s} cx="11" cy="11" r="6.5" />
          <Path {...s} d="m20 20-4.4-4.4" />
        </G>
      )
    case 'bookmark':
      return <Path {...s} d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.2L5.5 20.5v-16a1 1 0 0 1 1-1Z" />
    case 'dumbbell':
      return (
        <G>
          <Path {...s} d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" />
        </G>
      )
    case 'scale':
      return (
        <G>
          <Path {...s} d="M4.5 20.5 6 6.5a2 2 0 0 1 2-1.8h8a2 2 0 0 1 2 1.8l1.5 14H4.5Z" />
          <Path {...s} d="M12 8.5v3.5" />
          <Circle {...s} cx="12" cy="13.5" r="3" />
        </G>
      )
    case 'male':
      return (
        <G>
          <Circle {...s} cx="10" cy="14" r="5.2" />
          <Path {...s} d="M14.8 9.2 20 4M15 4h5v5" />
        </G>
      )
    case 'female':
      return (
        <G>
          <Circle {...s} cx="12" cy="9" r="5.2" />
          <Path {...s} d="M12 14.2V21M9 18.2h6" />
        </G>
      )
    case 'nonbinary':
      return (
        <G>
          <Circle {...s} cx="12" cy="14" r="5.2" />
          <Path {...s} d="M12 8.8V3M9.4 5l5.2 2.6M14.6 5 9.4 7.6" />
        </G>
      )
    case 'arrowUp':
      return <Path {...s} d="M12 20V4M5.5 10.5 12 4l6.5 6.5" />
    case 'arrowDown':
      return <Path {...s} d="M12 4v16M5.5 13.5 12 20l6.5-6.5" />
    case 'minus':
      return <Path {...s} d="M5 12h14" />
    case 'thumbUp':
      return (
        <G>
          <Path {...s} d="M7 10.5 11 3a2.2 2.2 0 0 1 2.2 2.2V9h4.6a2 2 0 0 1 2 2.4l-1.3 6a2 2 0 0 1-2 1.6H7" />
          <Rect {...s} x="3" y="10" width="4" height="9" rx="1" />
        </G>
      )
    case 'thumbDown':
      return (
        <G>
          <Path {...s} d="M7 13.5 11 21a2.2 2.2 0 0 0 2.2-2.2V15h4.6a2 2 0 0 0 2-2.4l-1.3-6a2 2 0 0 0-2-1.6H7" />
          <Rect {...s} x="3" y="5" width="4" height="9" rx="1" />
        </G>
      )
    case 'calendar':
      return (
        <G>
          <Rect {...s} x="3.5" y="5" width="17" height="15.5" rx="2" />
          <Path {...s} d="M3.5 9.5h17M8 3v4M16 3v4" />
        </G>
      )
    case 'handshake':
      return (
        <G>
          <Path {...s} d="M3 10.5 7 7l3 2.6 2-1.4 2 1.4L17 7l4 3.5" />
          <Path {...s} d="M7 7v7.5l5 4 5-4V7" />
        </G>
      )
    case 'burger':
      return (
        <G>
          <Path {...s} d="M3.5 8.5a8.5 4.5 0 0 1 17 0Z" />
          <Path {...s} d="M3.5 12.2h17M3.5 15.4h17" />
          <Path {...s} d="M4 18.4a3 3 0 0 0 3 2.1h10a3 3 0 0 0 3-2.1" />
        </G>
      )
    case 'bars':
      return (
        <G>
          <Rect {...s} x="4" y="12" width="4" height="8" rx="1" />
          <Rect {...s} x="10" y="7" width="4" height="13" rx="1" />
          <Rect {...s} x="16" y="10" width="4" height="10" rx="1" />
        </G>
      )
    case 'apple':
      return (
        <G>
          <Path {...s} d="M12 8c-1.4-1-3.2-1.2-4.6-.2C5.7 8.9 5 11 5.4 13.4c.5 3 2.6 6.6 4.6 6.6.8 0 1.3-.4 2-.4s1.2.4 2 .4c2 0 4.1-3.6 4.6-6.6.4-2.4-.3-4.5-2-5.6-1.4-1-3.2-.8-4.6.2Z" />
          <Path {...s} d="M12 8c0-2 1-3.6 3-4.2" />
        </G>
      )
    case 'sun':
      return (
        <G>
          <Circle {...s} cx="12" cy="12" r="4" />
          <Path {...s} d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19" />
        </G>
      )
    case 'muscle':
      return (
        <G>
          <Path {...s} d="M4 15.5c0-3 1.6-5 4.2-5 2 0 2.8 1.2 4.3 1.2 1.2 0 1.8-.8 3-.8 2.2 0 4.5 1.8 4.5 4.6 0 2.6-2 4.5-4.8 4.5H8.5C5.9 20 4 18.3 4 15.5Z" />
          <Path {...s} d="M8.2 10.5V6.4A2.4 2.4 0 0 1 10.6 4h1.6" />
        </G>
      )
    case 'lotus':
      return (
        <G>
          <Circle {...s} cx="12" cy="6" r="2.2" />
          <Path {...s} d="M12 10.5v4M6 20c1.5-2.5 3.6-4 6-4s4.5 1.5 6 4" />
          <Path {...s} d="M5 14.5c1.8.4 3 1.2 3.8 2.3M19 14.5c-1.8.4-3 1.2-3.8 2.3" />
        </G>
      )
    case 'leaf':
      return (
        <G>
          <Path {...s} d="M20 4C10 4 4.5 8 4.5 14.5A5.5 5.5 0 0 0 10 20c6.5 0 10-5.5 10-16Z" />
          <Path {...s} d="M18 6C13 9 10 13 8.5 19" />
        </G>
      )
    case 'fish':
      return (
        <G>
          <Path {...s} d="M3 12c3-4 6.5-6 10-6s6.5 2 8 6c-1.5 4-4.5 6-8 6s-7-2-10-6Z" />
          <Circle cx="15.5" cy="10.5" r="1" fill={c} stroke="none" />
          <Path {...s} d="M3 12c1.5-1 2.5-2.5 3-4M3 12c1.5 1 2.5 2.5 3 4" />
        </G>
      )
    case 'meat':
      return (
        <G>
          <Path {...s} d="M6.5 17.5a6 6 0 0 1 0-8.5l3-3a6 6 0 0 1 8.5 8.5l-3 3a6 6 0 0 1-8.5 0Z" />
          <Circle {...s} cx="13" cy="11" r="2.4" />
        </G>
      )
    case 'scaleBalance':
      return (
        <G>
          <Path {...s} d="M12 4v16M6 20h12M4 9h16" />
          <Path {...s} d="M4 9 1.5 14.5h5L4 9ZM20 9l-2.5 5.5h5L20 9Z" />
        </G>
      )
    case 'bowl':
      return (
        <G>
          <Path {...s} d="M3 11h18a9 9 0 0 1-9 9 9 9 0 0 1-9-9Z" />
          <Path {...s} d="M8 8c0-1.5 1-2.5 2-3M12 7.5c0-1.5 1-2.5 2-3" />
        </G>
      )
    case 'sprout':
      return (
        <G>
          <Path {...s} d="M12 21v-8" />
          <Path {...s} d="M12 13c0-3.3 2.7-6 6-6 0 3.3-2.7 6-6 6Z" />
          <Path {...s} d="M12 15c0-2.8-2.2-5-5-5 0 2.8 2.2 5 5 5Z" />
        </G>
      )
    case 'check':
      return <Path {...s} d="m5 12.5 4.5 4.5L19 7" />
    case 'chevron':
      return <Path {...s} d="m9 5 7 7-7 7" />
    case 'plus':
      return <Path {...s} d="M12 5v14M5 12h14" />
    case 'close':
      return <Path {...s} d="M6 6l12 12M18 6 6 18" />
    case 'pencil':
      return (
        <G>
          <Path {...s} d="M4 20h4L20 8a2.8 2.8 0 0 0-4-4L4 16v4Z" />
          <Path {...s} d="m14.5 5.5 4 4" />
        </G>
      )
    case 'image':
      // A photo: frame, sun, hills.
      return (
        <G>
          <Path {...s} d="M5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" />
          <Circle {...s} cx="9" cy="9.5" r="1.6" />
          <Path {...s} d="m3.5 16 5-4.5 4 3.5 3-2.5 5 4" />
        </G>
      )
    case 'heart':
      return (
        <Path
          {...s}
          d="M12 20s-7.5-4.4-7.5-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7.5 2.6c0 5-7.5 9.4-7.5 9.4Z"
        />
      )
    case 'clock':
      return (
        <G>
          <Circle {...s} cx="12" cy="12" r="8.5" />
          <Path {...s} d="M12 7v5.3l3.3 2" />
        </G>
      )
    case 'target':
      return (
        <G>
          <Circle {...s} cx="12" cy="12" r="8.5" />
          <Circle {...s} cx="12" cy="12" r="4" />
          <Circle cx="12" cy="12" r="1.4" fill={c} stroke="none" />
        </G>
      )
    case 'dot1':
      return <Circle cx="12" cy="12" r="2.6" fill={c} stroke="none" />
    case 'dot3':
      return (
        <G fill={c} stroke="none">
          <Circle cx="12" cy="7.5" r="2.1" />
          <Circle cx="7.5" cy="15.5" r="2.1" />
          <Circle cx="16.5" cy="15.5" r="2.1" />
        </G>
      )
    case 'dot6':
      return (
        <G fill={c} stroke="none">
          <Circle cx="8.5" cy="6.5" r="1.8" />
          <Circle cx="15.5" cy="6.5" r="1.8" />
          <Circle cx="8.5" cy="12" r="1.8" />
          <Circle cx="15.5" cy="12" r="1.8" />
          <Circle cx="8.5" cy="17.5" r="1.8" />
          <Circle cx="15.5" cy="17.5" r="1.8" />
        </G>
      )
  }
}
