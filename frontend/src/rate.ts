import type { Series } from './api'

/** Shown rate: % of the mean per decade for "relative" variables (precipitation), units per decade otherwise. */
export function shownRate(s: Series) {
  const rel = s.variable.kind === 'rel' && s.rate_rel ? s.rate_rel : undefined
  const rate = rel ?? s.rate
  if (!rate) throw new Error(`no trend for ${s.variable.id}`)
  return {
    rate,
    units: rel ? '%' : s.variable.units,
    decimals: rel ? 1 : s.variable.decimals,
  }
}
