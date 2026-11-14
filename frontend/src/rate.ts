import type { Series } from './api'

/** Shown rate: % of the mean per decade for "relative" variables (precipitation), units per decade otherwise. */
export function shownRate(s: Series) {
  const rel = s.variable.kind === 'rel' && s.rate_rel
  return {
    rate: rel ? s.rate_rel! : s.rate!,
    units: rel ? '%' : s.variable.units,
    decimals: rel ? 1 : s.variable.decimals,
  }
}
