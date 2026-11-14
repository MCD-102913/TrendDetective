import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Catalog, type ForecastMap, type ForecastSkill, type Region, type Series } from '../api'
import { useI18n } from '../i18n'
import { INK, useTheme } from '../theme'
import { Mark } from './Icon'
import { MapView } from './MapView'
import { PageShell } from './PageShell'
import { RegionSearch } from './RegionSearch'

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const MAX_TERR = 3
const COLORS = (ink: (typeof INK)['dark']) => [ink.annual, ink.compare, '#2e9d58']

function readUrl() {
  const p = new URLSearchParams(location.search)
  const view = p.get('view')
  let saved = 'simple'
  try {
    saved = localStorage.getItem('view') ?? 'simple' // the same choice as on the map
  } catch {
    /* storage blocked */
  }
  return {
    v: p.get('v'),
    r: (p.get('r') ?? '').split(',').filter(Boolean).slice(0, MAX_TERR),
    simple: view === 'simple' ? true : view === 'detailed' ? false : saved === 'simple',
  }
}

/** Simple view: the answer for one territory in a sentence, with a traffic light for how far to trust it. */
function SimpleForecast({ s, name, onDetailed }: { s: Series; name: string; onDetailed: () => void }) {
  const { t, l, num, unit } = useI18n()
  const o = s.outlook
  const d = s.variable.decimals
  const u = unit(s.variable.units)
  if (!o?.available) {
    return (
      <div className="verdicts simple-answer grey">
        <div className="simple-head">
          <span className="light" aria-hidden />
          <span className="simple-word">{t('fcs.none')}</span>
        </div>
        <p className="small simple-trust">{t(`fc.reason.${o?.available === false ? o.reason : 'no_hindcast'}`, { where: name })}</p>
        <p className="muted small">{t('fcs.tryOther')}</p>
      </div>
    )
  }
  const k = o.years.length - 1
  const now = s.mean + o.ref
  const end = s.mean + o.mid[k]
  const pct = (s.variable.kind === 'rel' || !s.variable.units) && now
  const change = pct ? `${num(((end - now) / Math.abs(now)) * 100, 0, true)}%` : `${num(end - now, d, true)} ${u}`.trim()
  return (
    <div className="verdicts simple-answer green">
      <div className="simple-head">
        <span className="light" aria-hidden />
        <span className="simple-word">{change}</span>
      </div>
      <p className="small">{t('fcs.sentence', { year: o.years[k], where: name, what: l(s.variable.name) })}</p>
      <div className="simple-change">
        <span className="small muted">{t('fcs.nowThen', { last: o.last_year, year: o.years[k] })}</span>
        <b>
          {num(now, d)} → {num(end, d)} {u}
        </b>
        <span className="small muted">{t('fcs.likely', { lo: num(s.mean + o.lo80[k], d), hi: num(s.mean + o.hi80[k], d) })}</span>
      </div>
      <p className="small simple-trust">{t('fcs.trust', { skill: num((o.hindcast.skill ?? 0) * 100, 0) })}</p>
      <button type="button" className="btn" onClick={onDetailed}>
        {t('simple.more')}
      </button>
    </div>
  )
}

/** Annual means and the outlook fans of up to three territories, in the variable's own units. */
function ForecastChart({ list, names }: { list: Series[]; names: string[] }) {
  const { t, num, unit } = useI18n()
  const { theme } = useTheme()
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const option = useMemo(() => {
    const ink = INK[theme]
    const colors = COLORS(ink)
    const series: object[] = []
    let xmax = 0
    let xmin = 9999
    list.forEach((s, i) => {
      const c = colors[i]
      const pts = s.annual.years
        .map((y, k) => [y + 0.5, s.annual.anomaly[k] === null ? null : s.mean + (s.annual.anomaly[k] as number)])
        .filter((p) => p[1] !== null)
      xmin = Math.min(xmin, s.annual.years[0])
      xmax = Math.max(xmax, s.annual.years[s.annual.years.length - 1] + 1)
      series.push({
        id: `a${i}`,
        name: names[i],
        type: 'line',
        symbol: 'circle',
        symbolSize: 4,
        z: 3,
        lineStyle: { width: 2, color: c },
        itemStyle: { color: c },
        data: pts,
      })
      const o = s.outlook
      if (o?.available) {
        const xs = [o.last_year + 0.5, ...o.years.map((y) => y + 0.5)]
        const at = (arr: number[], k: number) => s.mean + (k === 0 ? o.ref : arr[k - 1])
        const band = (lo: number[], hi: number[], id: string, opacity: number) => [
          {
            id: `${id}${i}lo`,
            name: names[i],
            type: 'line',
            stack: `${id}${i}`,
            silent: true,
            symbol: 'none',
            z: 2,
            lineStyle: { opacity: 0 },
            data: xs.map((x, k) => [x, at(lo, k)]),
          },
          {
            id: `${id}${i}w`,
            name: names[i],
            type: 'line',
            stack: `${id}${i}`,
            silent: true,
            symbol: 'none',
            z: 2,
            lineStyle: { opacity: 0 },
            areaStyle: { color: c, opacity },
            data: xs.map((x, k) => [x, at(hi, k) - at(lo, k)]),
          },
        ]
        series.push(...band(o.lo95, o.hi95, 'o95', 0.1), ...band(o.lo80, o.hi80, 'o80', 0.18), {
          id: `m${i}`,
          name: names[i],
          type: 'line',
          symbol: 'none',
          z: 4,
          lineStyle: { width: 2, type: 'dotted', color: c },
          data: xs.map((x, k) => [x, at(o.mid, k)]),
        })
        xmax = Math.max(xmax, o.years[o.years.length - 1] + 1)
      }
    })
    const d = list[0]?.variable.decimals ?? 2
    const axis = {
      axisLine: { lineStyle: { color: ink.axis } },
      axisTick: { show: false },
      axisLabel: { color: ink.muted, fontSize: 11 },
      splitLine: { lineStyle: { color: ink.grid } },
    }
    return {
      animation: false,
      grid: { left: 8, right: 14, top: 30, bottom: 6, containLabel: true },
      legend: { top: 0, left: 0, textStyle: { color: ink.muted, fontSize: 11 }, data: names },
      tooltip: {
        trigger: 'axis',
        backgroundColor: ink.tooltipBg,
        borderColor: ink.grid,
        textStyle: { color: ink.primary, fontSize: 12 },
        formatter: (ps: { seriesId: string; seriesName: string; value: [number, number]; color: string }[]) => {
          const year = Math.floor(ps[0].value[0])
          const rows = ps
            .filter((p) => p.seriesId.startsWith('a') || p.seriesId.startsWith('m'))
            .map(
              (p) =>
                `<span style="color:${p.color}">${p.seriesId.startsWith('m') ? '┄' : '●'}</span> ${p.seriesName}: <b>${num(p.value[1], d)}</b>`,
            )
          return `${year}<br/>${rows.join('<br/>')}`
        },
      },
      xAxis: {
        type: 'value',
        min: xmin,
        max: xmax,
        ...axis,
        splitLine: { show: false },
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => String(v) },
      },
      yAxis: {
        type: 'value',
        scale: true,
        name: list[0] ? unit(list[0].variable.units) : '',
        nameTextStyle: { color: ink.muted },
        ...axis,
      },
      series,
    }
  }, [list, names, theme, num, unit])
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
      <div ref={ref} className="chart fc-chart" role="img" aria-label={t('fc.chartNote')} />
      <figcaption className="muted small">{t('fc.chartNote')}</figcaption>
    </figure>
  )
}

/** "Forecasts": where the trend is expected to take each variable, and how far that can be trusted. */
export function ForecastPage() {
  const { t, l, num, unit } = useI18n()
  const init = useMemo(readUrl, [])
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [skill, setSkill] = useState<ForecastSkill | null>(null)
  const [vid, setVid] = useState<string | null>(init.v)
  const [map, setMap] = useState<ForecastMap | null>(null)
  const [terr, setTerr] = useState<Region[]>([])
  const [outlines, setOutlines] = useState<(GeoJSON.Geometry | null)[]>([])
  const [list, setList] = useState<Series[]>([])
  const [tab, setTab] = useState(0)
  const [simple, setSimpleState] = useState(init.simple)
  const setSimple = (v: boolean) => {
    try {
      localStorage.setItem('view', v ? 'simple' : 'detailed')
    } catch {
      /* storage blocked */
    }
    setSimpleState(v)
    setTab(0)
  }
  // the simple view follows one territory
  const shown = simple ? terr.slice(0, 1) : terr

  useEffect(() => {
    document.title = 'Trend Detective · forecasts'
    api
      .catalog()
      .then(setCatalog)
      .catch(() => {})
    api
      .forecastSkill()
      .then(setSkill)
      .catch(() => {})
    Promise.all(init.r.map((id) => api.region(id).catch(() => null))).then((rs) => setTerr(rs.filter((x): x is Region => !!x)))
    // nothing asked for in the link: the simple view opens on the visitor's own country
    if (!init.r.length && init.simple)
      api
        .home()
        .then((h) => (h.region_id ? api.region(h.region_id).then((r) => setTerr((ts) => (ts.length ? ts : [r]))) : undefined))
        .catch(() => {})
  }, [init])

  const shownAnywhere = (v: ForecastSkill['variables'][number]) => v.world.enabled || Object.values(v.zones).some((z) => z.enabled)
  const enabled = useMemo(() => (skill ? skill.variables.filter(shownAnywhere) : []), [skill])
  const disabled = useMemo(() => (skill ? skill.variables.filter((v) => !shownAnywhere(v)) : []), [skill])
  useEffect(() => {
    if (!vid && enabled.length) setVid(enabled.find((v) => v.id === 'ndvi')?.id ?? enabled[0].id)
  }, [vid, enabled])

  useEffect(() => {
    if (!vid) return
    setMap(null)
    api
      .forecastMap(vid)
      .then(setMap)
      .catch(() => setMap(null))
  }, [vid])
  useEffect(() => {
    if (!vid || !shown.length) return setList([])
    const ctrl = new AbortController()
    Promise.all(shown.map((r) => api.series(vid, { kind: 'region', region: r }, null, ctrl.signal)))
      .then(setList)
      .catch(() => {})
    return () => ctrl.abort()
  }, [vid, shown.map((r) => r.region_id).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    Promise.all(shown.slice(0, 2).map((r) => api.geometry(r.region_id).catch(() => null))).then(setOutlines)
  }, [shown.map((r) => r.region_id).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const p = new URLSearchParams()
    if (vid) p.set('v', vid)
    if (terr.length) p.set('r', terr.map((r) => r.region_id).join(','))
    p.set('view', simple ? 'simple' : 'detailed')
    const lang = new URLSearchParams(location.search).get('lang')
    if (lang) p.set('lang', lang)
    history.replaceState(null, '', `/forecast?${p}`)
  }, [vid, terr, simple])

  const add = (r: Region) => {
    setTerr((ts) => [r, ...ts.filter((x) => x.region_id !== r.region_id)].slice(0, MAX_TERR))
    setTab(0)
  }
  const variable = catalog?.variables.find((v) => v.id === vid)
  const sk = skill?.variables.find((v) => v.id === vid)
  const rows = map?.rows ?? []
  const avail = rows.filter((r) => r.available).sort((a, b) => (b.change ?? 0) - (a.change ?? 0))
  const d = map?.decimals ?? 2
  const u = map ? unit(map.units) : ''
  const names = list.map((s) => l(s.territory.name))
  const ready = list.length === shown.length && shown.length > 0
  const cur = list[tab]
  const verdictWord = (r: HindcastLike | undefined) =>
    !r ? (
      '·'
    ) : r.enabled ? (
      <>
        <Mark ok /> {num((r.skill ?? 0) * 100, 0, true)}%
      </>
    ) : r.cases < (skill?.rule.min_cases ?? 10) ? (
      '·'
    ) : (
      <Mark ok={false} fail="open" />
    )

  return (
    <PageShell active="forecast" variable={vid} region={terr[0]?.region_id} simple={simple} onSimple={setSimple}>
      <div className={`fc-layout ${simple ? 'fc-simple' : ''}`}>
        <aside className="fc-vars">
          <h2 className="step">{t('fc.pick')}</h2>
          <ul className="fc-list">
            {enabled.map((v) => (
              <li key={v.id}>
                <button type="button" className={`var ${v.id === vid ? 'active' : ''}`} onClick={() => setVid(v.id)}>
                  <span className="var-name">{l(v.name)}</span>
                  {!simple && (
                    <span className="var-meta">
                      {v.world.enabled
                        ? t('fc.world')
                        : t('fc.only', {
                            z: Object.entries(v.zones)
                              .filter(([, z]) => z.enabled)
                              .map(([k]) => (skill ? l(skill.rule.zones[k]) : k))
                              .join(', '),
                          })}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {simple ? (
            <p className="muted small">{t('fcs.listNote', { n: enabled.length, m: enabled.length + disabled.length })}</p>
          ) : (
            <details className="fc-off">
              <summary className="muted small">{t('fc.offTitle', { n: disabled.length })}</summary>
              <p className="muted small">{t('fc.offNote')}</p>
              <ul className="muted small">
                {disabled.map((v) => (
                  <li key={v.id}>{l(v.name)}</li>
                ))}
              </ul>
            </details>
          )}
        </aside>

        <section className="fc-map">
          <div className="fc-map-head">
            <h2 className="step">{variable ? t('fc.mapTitle', { what: l(variable.name), year: avail[0]?.year_end ?? '' }) : '…'}</h2>
            <RegionSearch placeholder={t(simple ? 'fcs.search' : 'fc.search')} onPick={add} />
          </div>
          <div className="pane fc-pane">
            <MapView
              overlayUrl={map ? `/api/forecast/map.png?variable=${map.variable}&g=${encodeURIComponent(map.generated)}` : null}
              bounds={map?.bounds ?? [-180, -85, 180, 85]}
              outline={outlines[0] ?? null}
              compareOutline={outlines[1] ?? null}
              point={null}
              fitTo={null}
              onPick={(lon, lat) =>
                vid &&
                api
                  .forecastWhere(vid, lat, lon)
                  .then(add)
                  .catch(() => {})
              }
              onOverlayState={() => {}}
              globe={false}
            />
            {map && (
              <div className="legend">
                <div className="legend-title">{t('fc.legend', { u: u ? `, ${u}` : '' })}</div>
                <div className="legend-bar" style={{ background: `linear-gradient(to right, ${map.colors.join(', ')})` }} />
                <div className="legend-ticks">
                  <span>{num(-map.scale, d, true)}</span>
                  <span>0</span>
                  <span>{num(map.scale, d, true)}</span>
                </div>
                <div className="muted small">{t(simple ? 'fcs.legendNote' : 'fc.legendNote', { n: avail.length, m: rows.length })}</div>
              </div>
            )}
          </div>
          {!simple && avail.length > 0 && (
            <div className="scan-cols fc-rank">
              {[
                [t('fc.up'), avail.filter((r) => (r.change ?? 0) > 0).slice(0, 8)],
                [
                  t('fc.down'),
                  avail
                    .filter((r) => (r.change ?? 0) < 0)
                    .reverse()
                    .slice(0, 8),
                ],
              ].map(([title, rs]) => (
                <div className="scan-col" key={title as string}>
                  <h4>{title as string}</h4>
                  {(rs as typeof avail).length === 0 && <p className="muted small">{t('scan.none')}</p>}
                  <ul>
                    {(rs as typeof avail).map((r) => (
                      <li key={r.region_id}>
                        <button type="button" onClick={() => add(r as unknown as Region)}>
                          <span>{l(r.name)}</span>
                          <span className="scan-rate">
                            {num(r.change ?? 0, d, true)} {u}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="fc-detail">
          {!terr.length && <p className="muted empty">{t(simple ? 'fcs.empty' : 'fc.empty')}</p>}
          {simple && shown.length > 0 && (
            <>
              <h2>{l(shown[0].name)}</h2>
              {ready && <SimpleForecast s={list[0]} name={names[0]} onDetailed={() => setSimple(false)} />}
              {ready && <ForecastChart list={list} names={names} />}
            </>
          )}
          {!simple && terr.length > 0 && (
            <>
              <div className="fc-chips">
                {terr.map((r, i) => (
                  <span key={r.region_id} className="fc-chip" style={{ borderColor: COLORS(INK.light)[i] }}>
                    {l(r.name)}
                    <button
                      type="button"
                      aria-label={t('compare.remove')}
                      onClick={() => setTerr((ts) => ts.filter((x) => x.region_id !== r.region_id))}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {terr.length < MAX_TERR && <span className="muted small">{t('fc.addMore')}</span>}
              </div>
              {ready && <ForecastChart list={list} names={names} />}
              <div className="rule-tabs" role="tablist">
                {list.map((_, i) => (
                  <button
                    type="button"
                    key={i}
                    role="tab"
                    aria-selected={tab === i}
                    className={`btn ${tab === i ? 'on' : ''}`}
                    onClick={() => setTab(i)}
                  >
                    {names[i]}
                  </button>
                ))}
              </div>
              {cur &&
                (cur.outlook?.available ? (
                  <>
                    <p className="small">
                      {t('fc.sentence', {
                        where: names[tab],
                        year: cur.outlook.years[cur.outlook.years.length - 1],
                        v: `${num(cur.mean + cur.outlook.mid[cur.outlook.mid.length - 1], d)} ${u}`,
                        now: `${num(cur.mean + cur.outlook.ref, d)} ${u}`,
                        last: cur.outlook.last_year,
                      })}
                    </p>
                    <table className="report-table fc-table small">
                      <thead>
                        <tr>
                          <th>{t('fc.col.year')}</th>
                          <th>{t('fc.col.mid')}</th>
                          <th>80%</th>
                          <th>95%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cur.outlook.years.map((y, k) => {
                          const o = cur.outlook as Extract<Series['outlook'], { available: true }>
                          const v = (x: number) => num(cur.mean + x, d)
                          return (
                            <tr key={y}>
                              <td>{y}</td>
                              <td>
                                <b>{v(o.mid[k])}</b>
                              </td>
                              <td>{t('fc.range', { lo: v(o.lo80[k]), hi: v(o.hi80[k]) })}</td>
                              <td>{t('fc.range', { lo: v(o.lo95[k]), hi: v(o.hi95[k]) })}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <p className="muted small">
                      {t('fc.model', {
                        m: t(`outlook.model.${cur.outlook.hindcast.model ?? 'line'}`),
                        where: cur.outlook.hindcast.scope_name ? l(cur.outlook.hindcast.scope_name) : '',
                        skill: num((cur.outlook.hindcast.skill ?? 0) * 100, 0),
                        cov: num((cur.outlook.hindcast.coverage95 ?? 0) * 100, 0),
                      })}
                    </p>
                  </>
                ) : (
                  <p className="note">
                    {t(`fc.reason.${cur.outlook?.available === false ? cur.outlook.reason : 'no_hindcast'}`, { where: names[tab] })}
                  </p>
                ))}
            </>
          )}
          {!simple && sk && skill && (
            <section className="fc-trust">
              <h3>{t('fc.trustTitle')}</h3>
              <table className="skill-table small">
                <thead>
                  <tr>
                    <th>{t('outlook.col.world')}</th>
                    {Object.keys(skill.rule.zones).map((z) => (
                      <th key={z}>{l(skill.rule.zones[z])}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{verdictWord(sk.world)}</td>
                    {Object.keys(skill.rule.zones).map((z) => (
                      <td key={z}>{verdictWord(sk.zones[z])}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
              <p className="muted small">{t('fc.trustNote')}</p>
            </section>
          )}
        </section>
      </div>
    </PageShell>
  )
}

type HindcastLike = { enabled: boolean; skill?: number; cases: number }
