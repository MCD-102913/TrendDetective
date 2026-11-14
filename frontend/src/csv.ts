// Data of the current view as CSV: a commented header with the trend report, then the monthly series.
import type { Series } from './api'

const cell = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return ''
  const s = String(v)
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function header(s: Series, name: string): string[] {
  const r = s.rate
  const lines = [
    `# Trend Detective, ${new Date().toISOString().slice(0, 10)}`,
    `# variable: ${s.variable.name.en} (${s.variable.id}), units: ${s.variable.units || 'none'}, source: ${s.variable.source}`,
    `# territory: ${name}, grid cells: ${s.territory.cells_with_data}`,
    `# period: ${s.period.start} to ${s.period.end}`,
    `# verdict: ${s.verdict}${s.robustness ? `, robust: ${s.robustness.robust}` : ''}`,
  ]
  if (r) lines.push(`# rate per decade: ${r.per_decade} (95% interval ${r.lo} to ${r.hi}) ${s.variable.units}`)
  if (s.rate_rel) lines.push(`# rate per decade, % of mean: ${s.rate_rel.per_decade} (95% interval ${s.rate_rel.lo} to ${s.rate_rel.hi})`)
  if (s.tests) {
    lines.push(`# t-test p: ${s.tests.t_test.p}, effective sample: ${s.tests.t_test.n_eff}, lag-1 autocorrelation: ${s.tests.t_test.r1}`)
    lines.push(`# Mann-Kendall p (annual means, Hamed-Rao): ${s.tests.mann_kendall.p}`)
  }
  if (s.sen) lines.push(`# Sen slope per decade: ${s.sen.per_decade} (${s.sen.lo} to ${s.sen.hi})`)
  for (const tw of s.second_opinion)
    lines.push(`# independent source ${tw.source} (${tw.id}): ${tw.per_decade} ${tw.units} per decade, ${tw.verdict}, agrees: ${tw.agrees}`)
  const o = s.outlook
  if (o?.available) {
    lines.push(
      `# if the trend continues (annual mean, the trend continued, not a climate model; model ${o.hindcast.model ?? 'line'}, checked on the past for ${o.hindcast.scope ?? 'world'}: ${o.hindcast.cases} cases, cross-validated skill ${o.hindcast.skill}, 95% coverage ${o.hindcast.coverage95})`,
    )
    o.years.forEach((y, k) =>
      lines.push(
        `#   ${y}: ${s.mean + o.mid[k]} (80% ${s.mean + o.lo80[k]} to ${s.mean + o.hi80[k]}, 95% ${s.mean + o.lo95[k]} to ${s.mean + o.hi95[k]})`,
      ),
    )
  }
  lines.push('# anomaly = value minus the mean of the same calendar month over the period')
  return lines
}

export function seriesCsv(main: Series, mainName: string, other: Series | null, otherName: string): string {
  const lines = header(main, mainName)
  if (other) lines.push(...header(other, otherName).map((x) => x.replace('# ', '# [2] ')))
  const cols = ['month', 'value', 'anomaly']
  if (other) cols.push('value_2', 'anomaly_2')
  lines.push(cols.join(','))
  const idx2 = new Map(other?.time.map((t, i) => [t, i]) ?? [])
  main.time.forEach((t, i) => {
    const row: (string | number | null)[] = [t, main.value[i], main.anomaly[i]]
    if (other) {
      const j = idx2.get(t)
      row.push(j === undefined ? null : other.value[j], j === undefined ? null : other.anomaly[j])
    }
    lines.push(row.map(cell).join(','))
  })
  return lines.join('\n') + '\n'
}

export function download(name: string, text: string): void {
  // BOM: Excel opens UTF-8 correctly only with it
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export const fileName = (s: Series, ext: string) =>
  `trend_${s.variable.id}_${(s.territory.region_id ?? 'point').toLowerCase()}_${s.period.start}_${s.period.end}.${ext}`
