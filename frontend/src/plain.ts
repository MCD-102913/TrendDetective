// The verdict in plain words: one or two sentences instead of numbers (simple view, report).
import type { Series } from './api'
import type { Key } from './i18n'
import { shownRate } from './rate'

type T = (key: Key, vars?: Record<string, string | number>) => string
type Num = (v: number | null | undefined, decimals?: number, signed?: boolean) => string
type L = (x: { en: string; ru: string } | null | undefined) => string

/** Lower-cases the first letter of a variable name unless it starts with an acronym (NDVI, NO2). */
function lowerName(s: string): string {
  return s.length > 1 && s[1] === s[1].toUpperCase() && s[1] !== s[1].toLowerCase() ? s : s.charAt(0).toLowerCase() + s.slice(1)
}

export function plainVerdict(s: Series, where: string, t: T, num: Num, l: L, unit: (u: string) => string): string[] {
  const what = lowerName(l(s.variable.name))
  const out: string[] = []
  if (!s.rate) return [t('plain.short', { where })]
  const { rate, units, decimals } = shownRate(s)
  const v = `${num(Math.abs(rate.per_decade), decimals)} ${unit(units)}`
  const dir = rate.per_decade > 0 ? 'up' : 'down'
  if (s.verdict.startsWith('significant')) {
    out.push(t(dir === 'up' ? 'plain.sig_up' : 'plain.sig_down', { where, what, v }))
    out.push(t(s.robustness?.robust ? 'plain.robust' : 'plain.fragile'))
  } else if (s.verdict.startsWith('likely')) {
    out.push(t(dir === 'up' ? 'plain.likely_up' : 'plain.likely_down', { where, what, v }))
  } else if (s.verdict === 'no_trend') {
    out.push(t('plain.none', { where, what, a: s.period.start.slice(0, 4), b: s.period.end.slice(0, 4) }))
  } else {
    out.push(t('plain.short', { where }))
  }
  const twin = s.second_opinion.find((x) => x.agrees) ?? s.second_opinion[0]
  if (twin && s.verdict.startsWith('significant'))
    out.push(t(twin.agrees ? 'plain.twin' : 'plain.twinNo', { name: lowerName(l(twin.name)), src: twin.source }))
  return out
}
