import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Series, type Verification, type VerifyTools } from '../api'
import { useI18n } from '../i18n'
import { INK, useTheme } from '../theme'
import { Mark } from './Icon'

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

function VerifyChart({ v }: { v: Verification }) {
  const { t, num } = useI18n()
  const { theme } = useTheme()
  const ref = useRef<HTMLDivElement>(null)
  const option = useMemo(() => {
    if (!v.series) return null
    const ink = INK[theme]
    const x = v.series.months.map((m) => Number(m.slice(0, 4)) + (Number(m.slice(5, 7)) - 0.5) / 12)
    const axis = {
      axisLine: { lineStyle: { color: ink.axis } },
      axisTick: { show: false },
      axisLabel: { color: ink.muted, fontSize: 11 },
      splitLine: { lineStyle: { color: ink.grid } },
    }
    const line = (name: string, ys: number[], color: string, width: number, dash?: string) => ({
      name,
      type: 'line',
      showSymbol: false,
      data: x.map((xx, i) => [xx, ys[i]]),
      lineStyle: { width, color, type: dash ?? 'solid' },
      itemStyle: { color },
    })
    return {
      animation: false,
      grid: { left: 8, right: 12, top: 28, bottom: 6, containLabel: true },
      legend: { top: 0, left: 0, itemWidth: 16, itemHeight: 8, textStyle: { color: ink.muted, fontSize: 11 } },
      tooltip: {
        trigger: 'axis',
        backgroundColor: ink.tooltipBg,
        borderColor: ink.grid,
        textStyle: { color: ink.primary, fontSize: 12 },
        valueFormatter: (val: number) => num(val, 2),
      },
      xAxis: {
        type: 'value',
        min: Math.floor(x[0]),
        max: Math.ceil(x[x.length - 1]),
        ...axis,
        splitLine: { show: false },
        axisLabel: { ...axis.axisLabel, showMaxLabel: false, formatter: (val: number) => String(val) },
      },
      yAxis: { type: 'value', scale: true, ...axis },
      series: [
        line(v.tool_name ?? 'NASA', v.series.ref, ink.compare, 3),
        line('Trend Detective', v.series.ours, ink.annual, 1.2, 'dashed'),
      ],
    }
  }, [v, theme, num])
  useEffect(() => {
    if (!ref.current || !option) return
    const c = echarts.init(ref.current)
    c.setOption(option)
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      c.dispose()
    }
  }, [option])
  return <div ref={ref} className="chart verify-chart" role="img" aria-label={t('verify.chart')} />
}

function Result({ v }: { v: Verification }) {
  const { t, num } = useI18n()
  if (v.verdict === 'too_short') return <p className="muted small">{t('verify.too_short')}</p>
  const d = Math.abs(v.trend_ours?.per_decade ?? 0) < 1 ? 3 : 2
  return (
    <div className={`verify-result ${v.verdict}`}>
      <div className="verdict-label">
        {t(`verify.${v.verdict}`)} · {v.tool_name}
      </div>
      <div className="small">
        {t('verify.stats', { r: num(v.r, 3), ra: num(v.r_anomaly, 3), b: num(v.rel_bias, 1, true), n: v.n_months })}
      </div>
      {v.trend_ours && v.trend_ref && (
        <div className="small">
          {t('verify.trends', {
            a: num(v.trend_ours.per_decade, d, true),
            b: num(v.trend_ref.per_decade, d, true),
            agree: t(v.trend_agrees ? 'verify.agree' : 'verify.disagree'),
          })}
        </div>
      )}
      <div className="muted small">
        {v.box
          ? t('verify.box', { w: num(v.box[0], 1), s: num(v.box[1], 1), e: num(v.box[2], 1), n: num(v.box[3], 1) })
          : v.point
            ? t('verify.point', { lon: num(v.point[0], 2), lat: num(v.point[1], 2) })
            : ''}
        {' · '}
        {v.period?.[0]} {t('word.to')} {v.period?.[1]}
      </div>
      <VerifyChart v={v} />
    </div>
  )
}

/** "Check against NASA tools": live check of the current territory + reference checks done in advance. */
export function VerifyCard({ s }: { s: Series }) {
  const { t, l } = useI18n()
  const [tools, setTools] = useState<VerifyTools | null>(null)
  const [ref, setRef] = useState<Verification[]>([])
  const [res, setRes] = useState<Verification | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .verifyTools()
      .then(setTools)
      .catch(() => {})
    api
      .verifyReference()
      .then((r) => setRef(r.cases.filter((c) => !c.error)))
      .catch(() => {})
  }, [])

  const avail = tools?.variables[s.variable.id] ?? []
  const point = s.territory.kind === 'point' && s.territory.cell ? s.territory.cell : null
  const tool = point && avail.includes('power') ? 'power' : avail[0]
  const run = () => {
    setBusy(true)
    setError(null)
    api
      .verify(s.variable.id, s.territory.region_id, point, tool)
      .then(setRes)
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setBusy(false))
  }
  const mine = ref.filter((c) => c.variable === s.variable.id)
  const rows = mine.length ? mine : ref

  return (
    <section className="verify">
      <h3>{t('verify.title')}</h3>
      {tool && tools ? (
        <button type="button" className="btn" onClick={run} disabled={busy}>
          {busy ? t('verify.running') : t('verify.run', { tool: tools.tools[tool].name })}
        </button>
      ) : (
        <p className="muted small">{t('verify.none')}</p>
      )}
      {error && <p className="error small">{error}</p>}
      {res && <Result v={res} />}
      {rows.length > 0 && (
        <>
          <h3>{t('verify.reference')}</h3>
          <p className="muted small">{t('verify.refHint')}</p>
          <div className="table-wrap">
            <table className="data-table verify-table">
              <thead>
                <tr>
                  <th>{t('verify.colVar')}</th>
                  <th>{t('verify.colPlace')}</th>
                  <th>{t('verify.colTool')}</th>
                  <th>r</th>
                  <th>{t('verify.colBias')}</th>
                  <th>{t('verify.colTrend')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr key={i} className={c.verdict}>
                    <td>{tools ? l(tools.names?.[c.variable] ?? { en: c.variable, ru: c.variable }) : c.variable}</td>
                    <td>{typeof c.place === 'string' ? c.place : l(c.place)}</td>
                    <td>{c.tool === 'giovanni' ? 'Giovanni' : 'POWER'}</td>
                    <td>{c.r_anomaly?.toFixed(3)}</td>
                    <td>
                      {c.rel_bias !== undefined && c.rel_bias !== null ? `${c.rel_bias > 0 ? '+' : ''}${c.rel_bias.toFixed(1)}%` : ''}
                    </td>
                    <td>
                      <Mark ok={Boolean(c.trend_agrees)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
