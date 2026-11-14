import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Relation, type Target, type Variable } from '../api'
import { useI18n } from '../i18n'
import { INK, useTheme } from '../theme'

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const zscore = (v: (number | null)[]) => {
  const x = v.filter((a): a is number => a !== null)
  const m = x.reduce((a, b) => a + b, 0) / Math.max(x.length, 1)
  const sd = Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(x.length - 1, 1)) || 1
  return v.map((a) => (a === null ? null : (a - m) / sd))
}

type Props = {
  variable: Variable
  variables: Variable[]
  target: Target
  startYear: number | null
  fixedOther?: string
  /** the second variable chosen from outside (a found link); the visitor can still change it */
  preset?: { id: string; n: number } | null
}

/** "Is it related to another variable?": correlation of the two series after removing season and trend. */
export function RelationCard({ variable, variables, target, startYear, fixedOther, preset }: Props) {
  const { t, l, num } = useI18n()
  const { theme } = useTheme()
  const [chosen, setOtherId] = useState('')
  const otherId = fixedOther ?? chosen
  const [rel, setRel] = useState<Relation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const card = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!preset) return
    setOtherId(preset.id)
    card.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [preset])

  useEffect(() => {
    if (!otherId || otherId === variable.id) {
      setRel(null)
      setError(null)
      return
    }
    const ctrl = new AbortController()
    setBusy(true)
    setError(null)
    api
      .relation(variable.id, otherId, target, startYear, ctrl.signal)
      .then((r) => {
        setRel(r)
        setBusy(false)
      })
      .catch((e) => {
        if (e.name === 'AbortError') return
        setRel(null)
        setError(String(e.message ?? e))
        setBusy(false)
      })
    return () => ctrl.abort()
  }, [variable.id, otherId, target, startYear])

  const option = useMemo(() => {
    if (!rel?.annual) return null
    const ink = INK[theme]
    const axis = {
      axisLine: { lineStyle: { color: ink.axis } },
      axisTick: { show: false },
      axisLabel: { color: ink.muted, fontSize: 11 },
      splitLine: { lineStyle: { color: ink.grid } },
    }
    const line = (name: string, v: (number | null)[], color: string) => ({
      name,
      type: 'line',
      symbol: 'circle',
      symbolSize: 4,
      connectNulls: false,
      lineStyle: { width: 2, color },
      itemStyle: { color },
      data: rel.annual!.years.map((y, i) => [y, v[i]]),
    })
    return {
      animation: false,
      grid: { left: 8, right: 14, top: 30, bottom: 6, containLabel: true },
      legend: { top: 0, left: 0, itemWidth: 16, itemHeight: 8, textStyle: { color: ink.muted, fontSize: 11 } },
      tooltip: {
        trigger: 'axis',
        backgroundColor: ink.tooltipBg,
        borderColor: ink.grid,
        textStyle: { color: ink.primary, fontSize: 12 },
        valueFormatter: (v: number | null) => (v === null ? '' : num(v, 2, true)),
      },
      xAxis: {
        type: 'value',
        min: rel.annual.years[0],
        max: rel.annual.years[rel.annual.years.length - 1],
        ...axis,
        splitLine: { show: false },
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => String(v) },
      },
      yAxis: { type: 'value', scale: true, ...axis, axisLabel: { ...axis.axisLabel, formatter: (v: number) => num(v, 0, true) } },
      series: [line(l(rel.x.name), zscore(rel.annual.x), ink.annual), line(l(rel.y.name), zscore(rel.annual.y), ink.compare)],
    }
  }, [rel, theme, l, num])

  useEffect(() => {
    if (!ref.current || !option) return
    const c = echarts.init(ref.current)
    chart.current = c
    c.setOption(option, { notMerge: true })
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      c.dispose()
    }
  }, [option])

  const groups = useMemo(() => {
    const out = new Map<string, Variable[]>()
    for (const v of variables) if (v.id !== variable.id) out.set(v.source, [...(out.get(v.source) ?? []), v])
    return [...out.entries()]
  }, [variables, variable.id])

  const linked = rel?.verdict === 'linked_positive' || rel?.verdict === 'linked_negative'
  return (
    <section className="relation" ref={card}>
      <h3>{t('rel.title')}</h3>
      {!fixedOther && (
        <select className="select" value={otherId} onChange={(e) => setOtherId(e.target.value)} aria-label={t('rel.pick')}>
          <option value="">{t('rel.pick')}</option>
          {groups.map(([source, items]) => (
            <optgroup key={source} label={source}>
              {items.map((v) => (
                <option key={v.id} value={v.id}>
                  {l(v.name)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
      {error && <p className="error small">{error}</p>}
      {rel && rel.best && (
        <div className={`rel-card ${busy ? 'loading' : ''} ${linked ? 'linked' : ''}`}>
          <div className="verdict-label">{t(`rel.${rel.verdict}`)}</div>
          <div className="rel-r">
            r = {num(rel.best.r, 2, true)}
            <span className="units">
              {' '}
              {rel.best.p < 0.001 ? `p < ${num(0.001, 3)}` : `p = ${num(rel.best.p, 3)}`}
              {rel.best.lag !== 0 && ` · ${t(rel.best.lag > 0 ? 'rel.lagX' : 'rel.lagY', { n: Math.abs(rel.best.lag) })}`}
            </span>
          </div>
          <p className="muted small">
            {linked
              ? t(rel.verdict === 'linked_positive' ? 'rel.explainPos' : 'rel.explainNeg', { pct: num((rel.explained ?? 0) * 100, 0) })
              : rel.verdict === 'common_trend_only'
                ? t('rel.explainTrend', { r: num(rel.raw.r, 2, true) })
                : t('rel.explainNone')}{' '}
            {t('rel.period', { a: rel.period.start, b: rel.period.end, n: num(rel.n_eff, 0) })}
          </p>
          <div ref={ref} className="chart rel-chart" role="img" aria-label={t('rel.chart')} />
          <p className="muted small">{t('rel.chart')}</p>
        </div>
      )}
    </section>
  )
}
