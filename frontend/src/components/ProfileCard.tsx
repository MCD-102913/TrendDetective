import { BarChart, CustomChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef, useState } from 'react'
import { api, type Profile, type Target } from '../api'
import { useI18n } from '../i18n'
import { INK, useTheme } from '../theme'

echarts.use([BarChart, CustomChart, GridComponent, TooltipComponent, CanvasRenderer])

// the ends of the diverging trend palette of the map: rising red, falling blue
const UP = '#b2182b'
const DOWN = '#2166ac'

/** Trend by height: the rate of one quantity at every pressure level of the territory; a click opens that level. */
export function ProfileCard({
  quantity,
  current,
  target,
  startYear,
  onPick,
}: {
  quantity: string
  current: string
  target: Target
  startYear: number | null
  onPick: (variableId: string) => void
}) {
  const { t, l, num } = useI18n()
  const { theme } = useTheme()
  const [data, setData] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setError(null)
    api
      .profile(quantity, target, startYear, ctrl.signal)
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(String(e.message ?? e))
      })
    return () => ctrl.abort()
  }, [quantity, target, startYear])

  useEffect(() => {
    if (!ref.current || !data) return
    const ink = INK[theme]
    const rows = data.levels.filter((r) => r.rate)
    const label = (r: Profile['levels'][number]) => t('profile.level', { p: r.level, km: num(r.height_km, 1) })
    const color = (r: Profile['levels'][number]) =>
      r.verdict === 'significant_up' ? UP : r.verdict === 'significant_down' ? DOWN : ink.muted
    const c = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    c.setOption({
      animation: false,
      grid: { left: 118, right: 16, top: 8, bottom: 30 },
      tooltip: {
        trigger: 'item',
        backgroundColor: ink.tooltipBg,
        textStyle: { color: ink.primary },
        formatter: (p: { dataIndex: number }) => {
          const r = rows[p.dataIndex]
          if (!r?.rate || r.verdict === 'no_data') return ''
          return `${label(r)}<br/>${num(r.rate.per_decade, data.decimals, true)} ${data.units} ${t('rate.perDecade')}<br/>${t(
            'profile.ci',
            { lo: num(r.rate.lo, data.decimals, true), hi: num(r.rate.hi, data.decimals, true) },
          )}<br/>${t(`verdict.${r.verdict}`)}`
        },
      },
      xAxis: {
        type: 'value',
        name: `${data.units} ${t('rate.perDecade')}`,
        nameLocation: 'middle',
        nameGap: 22,
        nameTextStyle: { color: ink.muted, fontSize: 11 },
        axisLabel: { color: ink.muted, fontSize: 11 },
        splitLine: { lineStyle: { color: ink.grid } },
      },
      yAxis: {
        type: 'category',
        data: rows.map(label),
        axisLabel: { color: ink.muted, fontSize: 11 },
        axisLine: { lineStyle: { color: ink.axis } },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          barWidth: '55%',
          data: rows.map((r) => ({
            value: r.rate?.per_decade ?? 0,
            itemStyle: {
              color: color(r),
              opacity: r.variable === current ? 1 : 0.75,
              borderColor: r.variable === current ? ink.primary : 'transparent',
              borderWidth: 1.5,
            },
          })),
        },
        {
          // the 95% interval of every level as a thin whisker over its bar
          type: 'custom',
          silent: true,
          data: rows.map((r, i) => [r.rate?.lo ?? 0, r.rate?.hi ?? 0, i]),
          renderItem: (_: unknown, api: { value: (k: number) => number; coord: (v: number[]) => number[] }) => {
            const a = api.coord([api.value(0), api.value(2)])
            const b = api.coord([api.value(1), api.value(2)])
            return { type: 'line', shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style: { stroke: ink.primary, lineWidth: 1.2 } }
          },
        },
      ],
    })
    c.on('click', (p) => {
      const r = rows[p.dataIndex]
      if (r) onPick(r.variable)
    })
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      c.dispose()
    }
  }, [data, theme, current, t, num, onPick])

  if (error) return null
  return (
    <section className="profile-card">
      <h3>{t('profile.title', { what: data ? l(data.name).toLowerCase() : '' })}</h3>
      <div ref={ref} className="profile-chart" style={{ height: 36 + 30 * (data?.levels.length ?? 4) }} />
      <p className="muted small">{t('profile.note', { a: data?.levels[0]?.years?.[0] ?? '', b: data?.levels[0]?.years?.[1] ?? '' })}</p>
    </section>
  )
}
