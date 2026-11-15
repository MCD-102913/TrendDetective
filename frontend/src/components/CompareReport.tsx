import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type MapMeta, type Region, type Relation, type Series, type Target } from '../api'
import { download, seriesCsv } from '../csv'
import { useI18n } from '../i18n'
import { plainVerdict } from '../plain'
import { shownRate } from '../rate'
import { applyTheme, INK, ThemeContext } from '../theme'
import { readView, viewQuery } from '../urlState'
import { MapFigure } from './Report'

echarts.use([LineChart, GridComponent, LegendComponent, CanvasRenderer])

const zscore = (v: (number | null)[]) => {
  const x = v.filter((a): a is number => a !== null)
  const m = x.reduce((s, a) => s + a, 0) / Math.max(x.length, 1)
  const sd = Math.sqrt(x.reduce((s, a) => s + (a - m) ** 2, 0) / Math.max(x.length - 1, 1)) || 1
  return v.map((a) => (a === null ? null : (a - m) / sd))
}

/** Annual anomalies of both variables in standard deviations (they have different units). */
function PairChart({ rel, nameA, nameB }: { rel: Relation; nameA: string; nameB: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current || !rel.annual) return
    const annual = rel.annual
    const ink = INK.light
    const c = echarts.init(ref.current)
    const line = (name: string, v: (number | null)[], color: string) => ({
      name,
      type: 'line',
      symbol: 'circle',
      symbolSize: 4,
      lineStyle: { width: 2, color },
      itemStyle: { color },
      data: annual.years.map((y, i) => [y, v[i]]),
    })
    const axis = {
      axisLine: { lineStyle: { color: ink.axis } },
      axisTick: { show: false },
      axisLabel: { color: ink.muted, fontSize: 11 },
      splitLine: { lineStyle: { color: ink.grid } },
    }
    c.setOption({
      animation: false,
      grid: { left: 8, right: 12, top: 30, bottom: 6, containLabel: true },
      legend: { top: 0, left: 0, itemWidth: 16, itemHeight: 8, textStyle: { color: ink.muted, fontSize: 11 } },
      xAxis: {
        type: 'value',
        min: rel.annual.years[0],
        max: rel.annual.years[rel.annual.years.length - 1],
        ...axis,
        splitLine: { show: false },
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => String(v) },
      },
      yAxis: { type: 'value', ...axis },
      series: [line(`A: ${nameA}`, zscore(rel.annual.x), ink.annual), line(`B: ${nameB}`, zscore(rel.annual.y), ink.compare)],
    })
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      c.dispose()
    }
  }, [rel, nameA, nameB])
  return <div ref={ref} className="chart" />
}

/** Printable comparison report: two variables on one territory (/report?v=A&v2=B&...). */
export function CompareReport() {
  const { t, l, num, unit, lang } = useI18n()
  const view = useMemo(() => readView(), [])
  const [a, setA] = useState<Series | null>(null)
  const [b, setB] = useState<Series | null>(null)
  const [rel, setRel] = useState<Relation | null>(null)
  const [metaA, setMetaA] = useState<MapMeta | null>(null)
  const [metaB, setMetaB] = useState<MapMeta | null>(null)
  const [outline, setOutline] = useState<GeoJSON.Geometry | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    applyTheme('light')
    document.title = 'TerraScope · comparison report'
    const va = view.variable ?? 't2m'
    const vb = view.variable2
    if (!vb) {
      setError('no second variable in the link')
      return
    }
    const target: Target = view.area
      ? { kind: 'area', polygon: { type: 'Polygon', coordinates: [[...view.area, view.area[0]]] }, terrain: view.terrain }
      : view.point
        ? { kind: 'point', point: view.point }
        : { kind: 'region', region: { region_id: view.region ?? 'global' } as Region, terrain: view.terrain }
    api
      .series(va, target, view.from)
      .then(setA)
      .catch((e) => setError(String(e.message ?? e)))
    api
      .series(vb, target, view.from)
      .then(setB)
      .catch((e) => setError(String(e.message ?? e)))
    api
      .relation(va, vb, target, view.from)
      .then(setRel)
      .catch(() => {})
    api
      .mapMeta(va, view.from)
      .then(setMetaA)
      .catch(() => {})
    api
      .mapMeta(vb, view.from)
      .then(setMetaB)
      .catch(() => {})
    if (view.region && view.region !== 'global' && !view.point)
      api
        .geometry(view.region)
        .then(setOutline)
        .catch(() => {})
  }, [view])

  const mapUrl = useMemo(() => `${location.origin}/?${viewQuery({ ...view, simple: null })}`, [view])
  if (error)
    return (
      <div className="report">
        <p className="error">{t('err.load', { msg: error })}</p>
      </div>
    )
  if (!a || !b)
    return (
      <div className="report">
        <p className="muted">{t('report.loading')}</p>
      </div>
    )

  const where =
    a.territory.kind === 'point' && a.territory.cell
      ? t('panel.point', { lat: num(a.territory.cell[1], 1), lon: num(a.territory.cell[0], 1) })
      : l(a.territory.name)
  const nameA = l(a.variable.name)
  const nameB = l(b.variable.name)
  const pText = (p: number | undefined) => (p === undefined ? '·' : p < 0.001 ? `< ${num(0.001, 3)}` : num(p, 3))
  const row = (s: Series, tag: string) => {
    const r = s.rate ? shownRate(s) : null
    return (
      <tr key={tag}>
        <td>
          <b>{tag}</b> {l(s.variable.name)}
          <div className="muted small">
            {s.variable.source} · {s.period.start} {t('word.to')} {s.period.end}
          </div>
        </td>
        <td>
          {r ? (
            <>
              <b>
                {num(r.rate.per_decade, r.decimals, true)} {unit(r.units)}
              </b>
              <div className="muted small">
                {num(r.rate.lo, r.decimals, true)} … {num(r.rate.hi, r.decimals, true)}
              </div>
            </>
          ) : (
            '·'
          )}
        </td>
        <td>
          {t(`verdict.${s.verdict}`)}
          {s.robustness?.robust ? <div className="muted small">{t('robust.yes')}</div> : null}
        </td>
        <td>{s.tests ? `${pText(s.tests.t_test.p)} / ${pText(s.tests.mann_kendall.p)}` : '·'}</td>
      </tr>
    )
  }
  const linked = rel?.verdict === 'linked_positive' || rel?.verdict === 'linked_negative'
  const mapBlock = (meta: MapMeta | null, s: Series, tag: string) =>
    meta && (
      <figure className="cmp-fig">
        <figcaption>
          <b>{tag}</b> {l(s.variable.name)}, {meta.units ? `${unit(meta.units)} ${t('rate.perDecade')}` : t('rate.perDecade')},{' '}
          {meta.years[0]} {t('word.to')} {meta.years[1]}
        </figcaption>
        <MapFigure meta={meta} overlay={api.mapUrl(s.variable.id, view.from, false)} outline={outline} compare={null} />
        <div className="report-legend">
          <span>{num(-meta.scale, meta.scale < 1 ? 2 : 1, true)}</span>
          <div className="legend-bar" style={{ background: `linear-gradient(to right, ${meta.colors.join(', ')})` }} />
          <span>{num(meta.scale, meta.scale < 1 ? 2 : 1, true)}</span>
        </div>
      </figure>
    )

  return (
    <ThemeContext.Provider value={{ theme: 'light', setTheme: () => {} }}>
      <div className="report">
        <div className="report-actions no-print">
          <button type="button" className="btn primary" onClick={() => window.print()}>
            {t('report.print')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() =>
              download(
                `compare_${a.variable.id}_${b.variable.id}_${(a.territory.region_id ?? 'point').toLowerCase()}.csv`,
                seriesCsv(a, `${where}, ${nameA}`, b, `${where}, ${nameB}`),
              )
            }
          >
            {t('report.csv')}
          </button>
          <a className="btn" href={mapUrl}>
            {t('report.back')}
          </a>
        </div>
        <header className="report-head">
          <div className="report-brand">TerraScope · {t('cmp.reportKind')}</div>
          <h1>
            {where}: {nameA} {t('report.vs')} {nameB}
          </h1>
          <div className="muted">
            {t('cmp.reportMeta', {
              date: new Date().toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
            })}
          </div>
        </header>

        <section className="report-block">
          <h2>{t('cmp.summary')}</h2>
          <div className="report-plain">
            {[...plainVerdict(a, where, t, num, l, unit).slice(0, 1), ...plainVerdict(b, where, t, num, l, unit).slice(0, 1)].map(
              (x, i) => (
                <p key={i}>{x}</p>
              ),
            )}
            {rel && rel.best && (
              <p>
                {t(`rel.${rel.verdict}`)}
                {linked &&
                  `: r = ${num(rel.best.r, 2, true)}${rel.best.lag ? `, ${t(rel.best.lag > 0 ? 'rel.lagX' : 'rel.lagY', { n: Math.abs(rel.best.lag) }).replace(/\.$/, '')}` : ''}. ${t(rel.verdict === 'linked_positive' ? 'rel.explainPos' : 'rel.explainNeg', { pct: num((rel.explained ?? 0) * 100, 0) })}`}
                {rel.verdict === 'common_trend_only' && `. ${t('rel.explainTrend', { r: num(rel.raw.r, 2, true) })}`}
                {rel.verdict === 'no_link' && `. ${t('rel.explainNone')}`}
              </p>
            )}
          </div>
        </section>

        <section className="report-block">
          <h2>{t('cmp.trends')}</h2>
          <table className="report-table cmp-table">
            <thead>
              <tr>
                <th>{t('cmp.colVar')}</th>
                <th>{t('report.rate')}</th>
                <th>{t('report.verdict')}</th>
                <th>{t('cmp.colP')}</th>
              </tr>
            </thead>
            <tbody>
              {row(a, 'A')}
              {row(b, 'B')}
            </tbody>
          </table>
        </section>

        {rel && rel.best && (
          <section className="report-block">
            <h2>{t('cmp.link')}</h2>
            <table className="report-table">
              <tbody>
                <tr>
                  <th>{t('cmp.rawR')}</th>
                  <td>
                    r = {num(rel.raw.r, 2, true)}, p {pText(rel.raw.p)}
                  </td>
                </tr>
                <tr>
                  <th>{t('cmp.detR')}</th>
                  <td>
                    r = {num(rel.detrended.r, 2, true)}, p {pText(rel.detrended.p)}
                  </td>
                </tr>
                <tr>
                  <th>{t('cmp.bestLag')}</th>
                  <td>
                    r = {num(rel.best.r, 2, true)}, p {pText(rel.best.p)} ·{' '}
                    {rel.best.lag === 0 ? t('cmp.noLag') : t(rel.best.lag > 0 ? 'rel.lagX' : 'rel.lagY', { n: Math.abs(rel.best.lag) })}
                  </td>
                </tr>
                <tr>
                  <th>{t('cmp.sample')}</th>
                  <td>{t('cmp.sampleText', { a: rel.period.start, b: rel.period.end, n: num(rel.n_eff, 0) })}</td>
                </tr>
              </tbody>
            </table>
            <PairChart rel={rel} nameA={nameA} nameB={nameB} />
            <p className="muted small">{t('rel.chart')}</p>
          </section>
        )}

        <section className="report-block cmp-maps">
          <h2>{t('cmp.maps')}</h2>
          <div className="cmp-grid">
            {mapBlock(metaA, a, 'A')}
            {mapBlock(metaB, b, 'B')}
          </div>
          <p className="muted small">{t('legend.sig')}</p>
        </section>

        <section className="report-block report-method">
          <h2>{t('report.method')}</h2>
          <p>{t('report.methodText')}</p>
          <p>{t('cmp.methodLink')}</p>
          <h2>{t('report.sources')}</h2>
          <p>{t('report.sourcesText')}</p>
          <p className="muted small">{t('report.link', { url: mapUrl })}</p>
        </section>
      </div>
    </ThemeContext.Provider>
  )
}
