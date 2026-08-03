/**
 * Chart palette.
 *
 * Both modes are selected rather than derived — the dark column is the same
 * eight hues re-stepped for a dark surface, not an automatic inversion. The set
 * was checked with a CVD validator on the adjacent-pair list: worst adjacent
 * separation is 9.1 (light) / 8.4 (dark) on the OKLab x100 scale, against a
 * target of 8, and worst normal-vision separation is 19.6 / 19.3 against a
 * floor of 15.
 *
 * Three light-mode hues sit below 3:1 contrast on the light surface. That is
 * allowed only with relief, which this UI provides: every series is also named
 * and numbered in the participant table, so identity is never carried by colour
 * alone.
 */

export const SERIES_LIGHT = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
] as const;

export const SERIES_DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
] as const;

/**
 * Series colour for a participant.
 *
 * Keyed by the participant's stable index, never by their current rank in a
 * filtered view: a reader who learned "P2 is orange" must not see orange move
 * to someone else when a filter changes. Past eight participants the colour
 * repeats, and the table's name column carries identity instead.
 */
export function seriesVar(index: number): string {
  return `var(--series-${(index % SERIES_LIGHT.length) + 1})`;
}

/** Single-hue blue ramp, light to dark, for magnitude encoding. */
export const SEQUENTIAL_STEPS = [
  '#cde2fb',
  '#b7d3f6',
  '#9ec5f4',
  '#86b6ef',
  '#6da7ec',
  '#5598e7',
  '#3987e5',
  '#2a78d6',
  '#256abf',
  '#1c5cab',
] as const;

/**
 * Map a 0..1 magnitude onto the sequential ramp.
 *
 * Zero returns null so the caller can render an empty cell in the surface
 * colour: "no messages at all" should read as absence, not as the palest blue.
 */
export function sequentialStep(fraction: number): string | null {
  if (!Number.isFinite(fraction) || fraction <= 0) return null;
  const index = Math.min(
    SEQUENTIAL_STEPS.length - 1,
    Math.floor(Math.sqrt(Math.min(fraction, 1)) * SEQUENTIAL_STEPS.length),
  );
  return SEQUENTIAL_STEPS[index];
}
