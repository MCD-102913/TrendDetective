import { LineChart, ScatterChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useMemo, useRef } from 'react'
import type { Series } from '../api'
import { useI18n } from '../i18n'
import { INK, useTheme } from '../theme'

echarts.use([LineChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const decimalYear = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return y + (m - 0.5) / 12
}

function trendLine(s: Series): [number, number][] {
  const perDecade = s.rate?.per_decade
  const intercept = s.rate?.intercept
  if (perDecade === undefined || intercept === undefined) return []
  const valid = s.time.filter((_, i) => s.anomaly[i] !== null)
  const a = decimalYear(valid[0])
  const b = decimalYear(valid[valid.length - 1])
  const f = (t: number) => (perDecade / 10) * t + intercept
  return [
    [a, f(a)],
    [b, f(b)],
  ]
}

/** Deseasonalized series: monthly anomalies (faint), annual means, the fitted trend; optional second territory. */
export function TrendChart({
  main,
  other,
  mainName,
  otherName,
  simple = false,
}: {
  main: Series
  other: Series | null
  mainName: string
  otherName: string
  /** simple view: annual means, the trend and the outlook only, no monthly noise and no legend */
  simple?: boolean
}) {
  const { t, num, unit } = useI18n()
  const { theme } = useTheme()
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)

  const option = useMemo(() => {
    const ink = INK[theme]
    const d = main.variable.decimals
    const annual = (s: Series) => s.annual.years.map((y, i) => [y + 0.5, s.annual.anomaly[i]]).filter((p) => p[1] !== null)
    const series: object[] = [
      simple
        ? { name: t('chart.monthly'), type: 'line', data: [] }
        : {
            name: t('chart.monthly'),
            type: 'line',
            showSymbol: false,
            silent: true,
            z: 1,
            lineStyle: { width: 1, color: ink.monthly },
            itemStyle: { color: ink.monthly },
            data: main.time.map((ym, i) => [decimalYear(ym), main.anomaly[i]]),
            connectNulls: false,
          },
      {
        name: other ? mainName : t('chart.annual'),
        type: 'line',
        z: 3,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2, color: ink.annual },
        itemStyle: { color: ink.annual },
        data: annual(main),
      },
      {
        name: t('chart.trend'),
        type: 'line',
        showSymbol: false,
        silent: true,
        z: 4,
        lineStyle: { width: 2, type: 'dashed', color: other ? ink.annual : ink.trend },
        itemStyle: { color: ink.trend },
        data: simple && main.verdict === 'no_trend' ? [] : trendLine(main),
      },
    ]
    const o = !other && main.outlook?.available ? main.outlook : null
    if (o) {
      // fan: 95% and 80% bands as stacked areas (lower edge invisible), then the continued line
      const xs = [o.last_year + 0.5, ...o.years.map((y) => y + 0.5)]
      const at = (arr: number[], k: number) => (k === 0 ? o.ref : arr[k - 1])
      const fan = t('outlook.legend')
      const band = (lo: number[], hi: number[], id: string, opacity: number) => [
        {
          id: `${id}_lo`,
          name: fan,
          type: 'line',
          stack: id,
          silent: true,
          symbol: 'none',
          z: 2,
          lineStyle: { opacity: 0 },
          itemStyle: { color: ink.annual },
          data: xs.map((x, k) => [x, at(lo, k)]),
        },
        {
          id: `${id}_w`,
          name: fan,
          type: 'line',
          stack: id,
          silent: true,
          symbol: 'none',
          z: 2,
          lineStyle: { opacity: 0 },
          itemStyle: { color: ink.annual },
          areaStyle: { color: ink.annual, opacity },
          data: xs.map((x, k) => [x, at(hi, k) - at(lo, k)]),
        },
      ]
      series.push(...band(o.lo95, o.hi95, 'o95', 0.12), ...band(o.lo80, o.hi80, 'o80', 0.2), {
        id: 'o_mid',
        name: fan,
        type: 'line',
        symbol: 'none',
        z: 4,
        lineStyle: { width: 2, type: 'dotted', color: ink.annual },
        itemStyle: { color: ink.annual },
        data: xs.map((x, k) => [x, at(o.mid, k)]),
      })
    }
    if (other) {
      series.push(
        {
          name: otherName,
          type: 'line',
          z: 3,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { width: 2, color: ink.compare },
          itemStyle: { color: ink.compare },
          data: annual(other),
        },
        {
          name: `${t('chart.trend')} 2`,
          type: 'line',
          showSymbol: false,
          silent: true,
          z: 4,
          lineStyle: { width: 2, type: 'dashed', color: ink.compare },
          itemStyle: { color: ink.compare },
          data: trendLine(other),
        },
      )
    }
    const axis = {
      axisLine: { lineStyle: { color: ink.axis } },
      axisTick: { show: false },
      axisLabel: { color: ink.muted, fontSize: 11 },
      splitLine: { lineStyle: { color: ink.grid } },
    }
    return {
      animation: false,
      grid: { left: 8, right: 14, top: simple ? 10 : o ? 52 : 34, bottom: 6, containLabel: true },
      legend: {
        show: !simple,
        top: 0,
        left: 0,
        itemWidth: 16,
        itemHeight: 8,
        textStyle: { color: ink.muted, fontSize: 11 },
        data: [...new Set(series.map((s) => (s as { name: string }).name))].filter((n) => !n.endsWith(' 2')),
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: ink.tooltipBg,
        borderColor: ink.grid,
        textStyle: { color: ink.primary, fontSize: 12 },
        formatter: (ps: { seriesName: string; seriesId?: string; value: [number, number | null]; color: string; seriesType: string }[]) => {
          const year = Math.floor(ps[0].value[0])
          const k = o ? o.years.indexOf(year) : -1
          const rows = ps
            .filter(
              (p) =>
                p.value[1] !== null &&
                !p.seriesName.startsWith(t('chart.trend')) &&
                p.seriesName !== t('chart.monthly') &&
                !p.seriesId?.startsWith('o'),
            )
            .map(
              (p) =>
                `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${num(p.value[1], d, true)}</b> ${unit(main.variable.units)}`,
            )
          if (o && k >= 0)
            rows.push(
              `<span style="color:${ink.annual}">┄</span> ${t('outlook.legend')}: <b>${num(o.mid[k], d, true)}</b> ${unit(main.variable.units)}<br/>` +
                t('outlook.tip', {
                  lo: num(o.lo80[k], d, true),
                  hi: num(o.hi80[k], d, true),
                  lo95: num(o.lo95[k], d, true),
                  hi95: num(o.hi95[k], d, true),
                }),
            )
          return rows.length ? `${year}<br/>${rows.join('<br/>')}` : ''
        },
      },
      xAxis: {
        type: 'value',
        min: Math.floor(decimalYear(main.time[0])),
        max: o ? o.years[o.years.length - 1] + 1 : Math.ceil(decimalYear(main.time[main.time.length - 1])),
        ...axis,
        splitLine: { show: false },
        axisLabel: { ...axis.axisLabel, showMaxLabel: false, formatter: (v: number) => String(v) },
      },
      yAxis: {
        type: 'value',
        scale: true,
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => num(v, v % 1 === 0 ? 0 : Math.min(d, 2), true) },
      },
      series,
    }
  }, [main, other, mainName, otherName, simple, theme, t, num, unit])

  useEffect(() => {
    if (!ref.current) return
    const c = echarts.init(ref.current)
    chart.current = c
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      c.dispose()
    }
  }, [])
  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true })
  }, [option])

  return (
    <figure className="chart-wrap">
      <div
        ref={ref}
        className="chart"
        role="img"
        aria-label={main.variable.units ? t('chart.note', { units: unit(main.variable.units) }) : t('chart.noteNoUnits')}
      />
      <figcaption className="muted small">
        {simple
          ? t('chart.noteSimple', { units: main.variable.units ? `, ${unit(main.variable.units)}` : '' }) +
            (main.verdict === 'no_trend' ? '' : ` ${t('chart.noteSimpleTrend')}`)
          : main.variable.units
            ? t('chart.note', { units: unit(main.variable.units) })
            : t('chart.noteNoUnits')}
      </figcaption>
    </figure>
  )
}
