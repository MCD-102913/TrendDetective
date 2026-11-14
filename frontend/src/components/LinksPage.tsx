import { BarChart, GraphChart, LineChart, ScatterChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Catalog, type L10n, type MatrixPair, type Region, type RelationMatrix, type Target } from '../api'
import { useI18n } from '../i18n'
import { INK, useTheme } from '../theme'
import { ruleYaml } from './Found'
import { Mark } from './Icon'
import { PageShell } from './PageShell'
import { RegionSearch } from './RegionSearch'

echarts.use([LineChart, ScatterChart, BarChart, GraphChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const MAX_VARS = 5
const SERIES_COLORS = ['#2a78d6', '#eb6834', '#2e9d58', '#9b59b6', '#c9a227']
const GLOBAL: Region = {
  region_id: 'global',
  level: -1,
  name: { en: 'Whole Earth', ru: 'Вся Земля' },
  parent_name: null,
  bbox: [-180, -90, 180, 90],
}

function readUrl() {
  const p = new URLSearchParams(location.search)
  const vs = (p.get('vs') ?? '').split(',').filter(Boolean).slice(0, MAX_VARS)
  return {
    vs:
      vs.length >= 2 ? vs : vs.length === 1 ? [vs[0], vs[0] === 'precip_gpm' ? 'ndvi' : 'precip_gpm'] : ['precip_gpm', 'soil_root', 'ndvi'],
    r: p.get('r'),
  }
}

function useChart(option: echarts.EChartsCoreOption | null) {
  // the chart's element appears only once there are data (and is replaced when a pair is picked): the chart is set up lazily
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const ro = useRef<ResizeObserver | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !option) return
    if (chart.current && chart.current.getDom() !== el) {
      ro.current?.disconnect()
      chart.current.dispose()
      chart.current = null
    }
    if (!chart.current) {
      const c = echarts.init(el)
      chart.current = c
      ro.current = new ResizeObserver(() => c.resize())
      ro.current.observe(el)
    }
    chart.current.setOption(option, { notMerge: true })
  })
  useEffect(
    () => () => {
      ro.current?.disconnect()
      chart.current?.dispose()
    },
    [],
  )
  return ref
}

const zscore = (v: (number | null)[]) => {
  const x = v.filter((a): a is number => a !== null)
  const m = x.reduce((a, b) => a + b, 0) / Math.max(x.length, 1)
  const sd = Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(x.length - 1, 1)) || 1
  return v.map((a) => (a === null ? null : (a - m) / sd))
}

const linked = (p: MatrixPair) => p.verdict === 'linked_positive' || p.verdict === 'linked_negative'

/** "Links": two to five variables on one territory, every pair tested, drawn as a matrix, a graph and charts. */
export function LinksPage() {
  const { t, l, num } = useI18n()
  const { theme } = useTheme()
  const init = useMemo(readUrl, [])
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [vs, setVs] = useState<string[]>(init.vs)
  const [region, setRegion] = useState<Region>(GLOBAL)
  const [data, setData] = useState<RelationMatrix | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<[string, string] | null>(null)
  const [ruleMsg, setRuleMsg] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Trend Detective · links'
    api
      .catalog()
      .then(setCatalog)
      .catch(() => {})
    if (init.r)
      api
        .region(init.r)
        .then(setRegion)
        .catch(() => {})
  }, [init])
  useEffect(() => {
    if (vs.length < 2) return setData(null)
    const ctrl = new AbortController()
    const target: Target = { kind: 'region', region }
    setBusy(true)
    setError(null)
    api
      .matrix(vs, target, ctrl.signal)
      .then((d) => {
        setData(d)
        setBusy(false)
        const best = [...d.pairs].filter(linked).sort((a, b) => Math.abs(b.best?.r ?? 0) - Math.abs(a.best?.r ?? 0))[0] ?? d.pairs[0]
        setSel(best ? [best.a, best.b] : null)
      })
      .catch((e) => {
        if (e.name === 'AbortError') return
        setError(String(e.message ?? e))
        setBusy(false)
      })
    const p = new URLSearchParams({ vs: vs.join(',') })
    if (region.region_id !== 'global') p.set('r', region.region_id)
    const lang = new URLSearchParams(location.search).get('lang')
    if (lang) p.set('lang', lang)
    history.replaceState(null, '', `/links?${p}`)
    return () => ctrl.abort()
  }, [vs, region])

  const name = (id: string): L10n =>
    data?.variables.find((v) => v.id === id)?.name ?? catalog?.variables.find((v) => v.id === id)?.name ?? { en: id, ru: id }
  const pairOf = (a: string, b: string) => data?.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a))
  const pair = sel ? pairOf(sel[0], sel[1]) : undefined
  const ink = INK[theme]
  const axis = {
    axisLine: { lineStyle: { color: ink.axis } },
    axisTick: { show: false },
    axisLabel: { color: ink.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: ink.grid } },
  }
  const tip = { backgroundColor: ink.tooltipBg, borderColor: ink.grid, textStyle: { color: ink.primary, fontSize: 12 } }

  // graph: proven links as edges, the leader -> the follower when there is a delay
  const graphOption = useMemo(() => {
    if (!data) return null
    const edges = data.pairs.filter(linked).map((p) => {
      const lag = p.best?.lag ?? 0
      const [s, d] = lag < 0 ? [p.b, p.a] : [p.a, p.b]
      const r = p.best?.r ?? 0
      return {
        source: s,
        target: d,
        value: r,
        lineStyle: { width: 1 + 7 * Math.abs(r), color: r > 0 ? ink.up : ink.down, curveness: 0.12, opacity: 0.85 },
        symbol: ['none', lag === 0 ? 'none' : 'arrow'],
        symbolSize: 10,
        label: {
          show: true,
          formatter: `${num(r, 2, true)}${lag ? ` · ${Math.abs(lag)} ${t('lk.mo')}` : ''}`,
          color: ink.muted,
          fontSize: 11,
        },
      }
    })
    return {
      animation: false,
      tooltip: {
        ...tip,
        formatter: (x: { dataType: string; data: { source?: string; target?: string; value?: number; name?: string } }) =>
          x.dataType === 'edge'
            ? `${l(name(x.data.source!))} → ${l(name(x.data.target!))}: r = ${num(x.data.value!, 2, true)}`
            : l(name(x.data.name!)),
      },
      series: [
        {
          type: 'graph',
          layout: 'circular',
          circular: { rotateLabel: false },
          roam: false,
          edgeSymbol: ['none', 'arrow'],
          label: { show: true, position: 'bottom', color: ink.primary, fontSize: 12, formatter: (x: { name: string }) => l(name(x.name)) },
          data: data.variables.map((v, i) => ({ name: v.id, symbolSize: 26, itemStyle: { color: SERIES_COLORS[i] } })),
          links: edges,
          lineStyle: { opacity: 0.85 },
        },
      ],
    }
  }, [data, theme, l, num, t]) // eslint-disable-line react-hooks/exhaustive-deps

  const overlayOption = useMemo(() => {
    if (!data) return null
    const series = data.variables
      .filter((v) => data.annual[v.id])
      .map((v, i) => {
        const a = data.annual[v.id]
        const z = zscore(a.value)
        return {
          name: l(v.name),
          type: 'line',
          symbolSize: 4,
          lineStyle: { width: 2, color: SERIES_COLORS[i] },
          itemStyle: { color: SERIES_COLORS[i] },
          data: a.years.map((y, k) => [y + 0.5, z[k]]).filter((p) => p[1] !== null),
        }
      })
    return {
      animation: false,
      grid: { left: 8, right: 14, top: 36, bottom: 6, containLabel: true },
      legend: { top: 0, left: 0, textStyle: { color: ink.muted, fontSize: 11 } },
      tooltip: { trigger: 'axis', ...tip, valueFormatter: (v: number) => num(v, 2, true) },
      xAxis: {
        type: 'value',
        min: 'dataMin',
        max: 'dataMax',
        ...axis,
        splitLine: { show: false },
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => String(Math.floor(v)) },
      },
      yAxis: { type: 'value', ...axis },
      series,
    }
  }, [data, theme, l, num]) // eslint-disable-line react-hooks/exhaustive-deps

  const scatterOption = useMemo(() => {
    if (!pair?.points) return null
    const xs = pair.points.x,
      ys = pair.points.y
    const n = xs.length
    const mx = xs.reduce((a, b) => a + b, 0) / n,
      my = ys.reduce((a, b) => a + b, 0) / n
    const sxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0),
      sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0)
    const k = sxx ? sxy / sxx : 0
    const lo = Math.min(...xs),
      hi = Math.max(...xs)
    return {
      animation: false,
      grid: { left: 8, right: 14, top: 10, bottom: 24, containLabel: true },
      tooltip: { ...tip, formatter: (p: { value: [number, number] }) => `${num(p.value[0], 3, true)} · ${num(p.value[1], 3, true)}` },
      xAxis: {
        type: 'value',
        name: l(name(pair.a)),
        nameLocation: 'middle',
        nameGap: 22,
        nameTextStyle: { color: ink.muted },
        scale: true,
        ...axis,
      },
      yAxis: { type: 'value', name: l(name(pair.b)), nameTextStyle: { color: ink.muted }, scale: true, ...axis },
      series: [
        { type: 'scatter', symbolSize: 4, itemStyle: { color: ink.annual, opacity: 0.55 }, data: xs.map((x, i) => [x, ys[i]]) },
        {
          type: 'line',
          symbol: 'none',
          silent: true,
          lineStyle: { color: ink.trend, width: 2, type: 'dashed' },
          data: [
            [lo, my + k * (lo - mx)],
            [hi, my + k * (hi - mx)],
          ],
        },
      ],
    }
  }, [pair, theme, l, num]) // eslint-disable-line react-hooks/exhaustive-deps

  const lagOption = useMemo(() => {
    if (!pair?.lags) return null
    const best = pair.best?.lag
    return {
      animation: false,
      grid: { left: 8, right: 14, top: 10, bottom: 24, containLabel: true },
      tooltip: { trigger: 'axis', ...tip, valueFormatter: (v: number) => num(v, 2, true) },
      xAxis: {
        type: 'category',
        data: pair.lags.map((k) => k.lag),
        name: t('lk.lagAxis'),
        nameLocation: 'middle',
        nameGap: 22,
        nameTextStyle: { color: ink.muted },
        ...axis,
      },
      yAxis: { type: 'value', min: -1, max: 1, ...axis },
      series: [
        { type: 'bar', data: pair.lags.map((k) => ({ value: k.r, itemStyle: { color: k.lag === best ? ink.annual : ink.monthly } })) },
      ],
    }
  }, [pair, theme, num, t]) // eslint-disable-line react-hooks/exhaustive-deps

  const graphRef = useChart(graphOption)
  const overlayRef = useChart(overlayOption)
  const scatterRef = useChart(scatterOption)
  const lagRef = useChart(lagOption)

  // a pair or a chain as a hypothesis of this browser tab: stored with the others, opened on the map
  const toRule = async (yaml: string) => {
    setRuleMsg(null)
    const r = await api.tryRule(yaml)
    if ('errors' in r) return setRuleMsg(r.errors.join('; '))
    try {
      const saved = JSON.parse(sessionStorage.getItem('sessionRules') ?? '[]')
      sessionStorage.setItem('sessionRules', JSON.stringify([...saved, { id: r.id, yaml, result: { ...r, territories: [] } }]))
    } catch {
      /* storage blocked: the rule is only shown here */
    }
    location.href = `/?view=detailed&rule=${encodeURIComponent(r.id)}`
  }
  const pairRule = (p: MatrixPair) => {
    const lag = p.best?.lag ?? 0
    const [from, to] = lag < 0 ? [p.b, p.a] : [p.a, p.b]
    const nf = name(from),
      nt = name(to)
    return ruleYaml(
      { en: `${nf.en} and ${nt.en}`, ru: `${nf.ru} и ${nt.ru}` },
      1,
      [{ from, to, sign: (p.best?.r ?? 0) >= 0 ? '+' : '-', lag }],
      false,
      'checked',
    )
  }

  const groups = catalog
    ? Object.entries(catalog.spheres)
        .map(([id, n]) => ({ id, n, items: catalog.variables.filter((v) => v.sphere === id && !vs.includes(v.id)) }))
        .filter((g) => g.items.length)
    : []
  const cellColor = (r: number) =>
    r > 0 ? `rgba(184, 49, 47, ${0.15 + 0.7 * Math.abs(r)})` : `rgba(28, 92, 171, ${0.15 + 0.7 * Math.abs(r)})`

  return (
    <PageShell active="links" variable={vs[0]} region={region.region_id}>
      <div className="lk-controls">
        <div className="lk-vars">
          {vs.map((v, i) => (
            <span key={v} className="fc-chip" style={{ borderColor: SERIES_COLORS[i] }}>
              {l(name(v))}
              {vs.length > 2 && (
                <button type="button" aria-label={t('compare.remove')} onClick={() => setVs((x) => x.filter((y) => y !== v))}>
                  ×
                </button>
              )}
            </span>
          ))}
          {vs.length < MAX_VARS && (
            <select
              className="var-select"
              value=""
              onChange={(e) => e.target.value && setVs((x) => [...x, e.target.value])}
              aria-label={t('lk.add')}
            >
              <option value="">{t('lk.add')}</option>
              {groups.map((g) => (
                <optgroup key={g.id} label={l(g.n)}>
                  {g.items.map((v) => (
                    <option key={v.id} value={v.id}>
                      {l(v.name)} · {v.source}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </div>
        <div className="lk-where">
          <b>{l(region.name)}</b>
          <RegionSearch placeholder={t('lk.where')} onPick={setRegion} />
          {region.region_id !== 'global' && (
            <button type="button" className="btn" onClick={() => setRegion(GLOBAL)}>
              {t('lk.world')}
            </button>
          )}
        </div>
      </div>
      {error && <p className="error">{t('err.load', { msg: error })}</p>}
      {busy && !data && <p className="muted">{t('lk.loading')}</p>}
      {data && (
        <div className={`lk-grid ${busy ? 'loading' : ''}`}>
          <section className="lk-card">
            <h3>{t('lk.matrix')}</h3>
            <p className="muted small">{t('lk.matrixNote')}</p>
            <div className="skill-wrap">
              <table className="lk-matrix">
                <thead>
                  <tr>
                    <th />
                    {data.variables.map((v) => (
                      <th key={v.id}>{l(v.name)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.variables.map((row) => (
                    <tr key={row.id}>
                      <th>{l(row.name)}</th>
                      {data.variables.map((col) => {
                        if (row.id === col.id)
                          return (
                            <td key={col.id} className="lk-diag">
                              ·
                            </td>
                          )
                        const p = pairOf(row.id, col.id)
                        const r = p?.best?.r
                        const on = sel && ((sel[0] === row.id && sel[1] === col.id) || (sel[0] === col.id && sel[1] === row.id))
                        return (
                          <td
                            key={col.id}
                            className={`lk-cell ${on ? 'on' : ''}`}
                            style={p && linked(p) && r !== undefined ? { background: cellColor(r) } : undefined}
                          >
                            <button type="button" onClick={() => setSel([row.id, col.id])} title={p ? t(`rel.${p.verdict}`) : ''}>
                              {r === undefined || r === null ? '·' : num(r, 2, true)}
                              {p && linked(p) && (
                                <span className="lk-mark">
                                  <Mark ok />
                                  {p.best?.lag ? ` ${Math.abs(p.best.lag)} ${t('lk.mo')}` : ''}
                                </span>
                              )}
                              {p?.verdict === 'common_trend_only' && <span className="lk-mark muted">{t('lk.trendOnly')}</span>}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="lk-card">
            <h3>{t('lk.graph')}</h3>
            <div ref={graphRef} className="lk-graph" />
            <p className="muted small">{t('lk.graphNote')}</p>
            {data.found.chains.length > 0 && (
              <>
                <h4>{t('lk.chains')}</h4>
                <ul className="found-list">
                  {data.found.chains.map((c) => (
                    <li key={`${c.a}${c.b}${c.c}`}>
                      <button
                        type="button"
                        onClick={() =>
                          toRule(
                            ruleYaml(
                              {
                                en: `${c.a_name.en} → ${c.b_name.en} → ${c.c_name.en}`,
                                ru: `${c.a_name.ru} → ${c.b_name.ru} → ${c.c_name.ru}`,
                              },
                              1,
                              [
                                { from: c.a, to: c.b, sign: c.r_ab >= 0 ? '+' : '-', lag: c.lag1 },
                                { from: c.b, to: c.c, sign: c.r_bc >= 0 ? '+' : '-', lag: c.lag2 },
                              ],
                              false,
                              'checked',
                            ),
                          )
                        }
                      >
                        <span>
                          {l(c.a_name)} → {l(c.b_name)} → {l(c.c_name)}
                        </span>
                        <span className="muted small">
                          r = {num(c.r_ac, 2, true)} → {num(c.partial, 2, true)} · {t('lk.toRule')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="lk-card lk-wide">
            <h3>{t('lk.overlay')}</h3>
            <div ref={overlayRef} className="lk-overlay" />
            <p className="muted small">{t('lk.overlayNote')}</p>
          </section>

          <section className="lk-card lk-wide">
            <h3>{pair ? `${l(name(pair.a))} ↔ ${l(name(pair.b))}` : t('lk.pickPair')}</h3>
            {pair && (
              <>
                <p className="small">
                  {t(`rel.${pair.verdict}`)}
                  {pair.best &&
                    ` · ${t('lk.best', { r: num(pair.best.r, 2, true), lag: pair.best.lag, p: pair.best.p < 0.001 ? '< 0,001' : num(pair.best.p, 3) })}`}
                  {pair.period && ` · ${pair.period[0]} ${t('word.to')} ${pair.period[1]}`}
                </p>
                <div className="lk-pair">
                  <div>
                    <div ref={scatterRef} className="lk-small" />
                    <p className="muted small">{t('lk.scatterNote')}</p>
                  </div>
                  <div>
                    <div ref={lagRef} className="lk-small" />
                    <p className="muted small">{t('lk.lagNote')}</p>
                  </div>
                </div>
                {linked(pair) && (
                  <button type="button" className="btn" onClick={() => toRule(pairRule(pair))}>
                    {t('lk.toRule')}
                  </button>
                )}
              </>
            )}
            {ruleMsg && <p className="error small">{ruleMsg}</p>}
          </section>
        </div>
      )}
    </PageShell>
  )
}
