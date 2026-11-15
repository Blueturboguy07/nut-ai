/**
 * Exercise energy — deterministic MET arithmetic, not a model guess.
 *
 * kcal = MET x 3.5 x kg / 200 x minutes (the standard ACSM formula). MET
 * values are from the Compendium of Physical Activities, matched to three
 * common intensity anchors (low, medium, high). D16 applies to
 * exercise exactly as it does to food: Run and Weight lifting never touch a
 * model — only the free-text Describe path does, and it is labeled as such.
 */

export type ExerciseKind = 'run' | 'weights'
export type Intensity = 'low' | 'medium' | 'high'

export interface IntensityAnchor {
  level: Intensity
  title: string
  desc: string
  met: number
}

export const INTENSITY_ANCHORS: Record<ExerciseKind, readonly IntensityAnchor[]> = {
  run: [
    { level: 'high', title: 'High', desc: 'Sprinting — 14 mph (4 minute miles)', met: 12.5 },
    { level: 'medium', title: 'Medium', desc: 'Jogging — 6 mph (10 minute miles)', met: 9.8 },
    { level: 'low', title: 'Low', desc: 'Chill walk — 3 mph (20 minute miles)', met: 3.5 },
  ],
  weights: [
    { level: 'high', title: 'High', desc: 'Training to failure, breathing heavily', met: 6.0 },
    { level: 'medium', title: 'Medium', desc: 'Breaking a sweat, many reps', met: 4.5 },
    { level: 'low', title: 'Low', desc: 'Not breaking a sweat, giving little effort', met: 3.0 },
  ],
}

export function metFor(kind: ExerciseKind, level: Intensity): number {
  return INTENSITY_ANCHORS[kind].find((a) => a.level === level)!.met
}

/** Standard formula; weight matters — 30 hard minutes differ ~40% between 60 and 100 kg. */
export function exerciseKcal(kind: ExerciseKind, level: Intensity, weightKg: number, minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(weightKg) || weightKg <= 0) return 0
  return Math.round((metFor(kind, level) * 3.5 * weightKg * minutes) / 200)
}
