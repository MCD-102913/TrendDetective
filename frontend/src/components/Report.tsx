import { useEffect, useMemo, useState } from 'react'
import { api, type MapMeta, type Region, type Series, type Target, type Variable } from '../api'
import { download, fileName, seriesCsv } from '../csv'
import { useI18n } from '../i18n'
import { plainVerdict } from '../plain'
import { shownRate } from '../rate'
import { applyTheme, ThemeContext } from '../theme'
import { readView, viewQuery } from '../urlState'
import { Mark } from './Icon'
import { OutlookNote } from './Outlook'
import { TrendChart } from './TrendChart'

// Map extent of the printed figure (Mercator, same projection as the trend PNG from the API)
const W = 1000
const MERC_MAX = 85
const LAT_TOP = 80
const LAT_BOTTOM = -60
const ymerc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-MERC_MAX, Math.min(MERC_MAX, lat)) * Math.PI) / 360))
const YMAX = ymerc(MERC_MAX)
const px = (lon: number) => ((lon + 180) / 360) * W
const py = (lat: number) => ((YMAX - ymerc(lat)) / (2 * YMAX)) * W

function ringsOf(g: GeoJSON.Geometry): number[][][] {
  if (g.type === 'Polygon') return g.coordinates
  if (g.type === 'MultiPolygon') return g.coordinates.flat()
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(ringsOf)
  return []
}
const pathOf = (g: GeoJSON.Geometry) =>
  ringsOf(g)
    .map((r) => 'M' + r.map(([x, y]) => `${px(x).toFixed(1)},${py(y).toFixed(1)}`).join('L') + 'Z')
    .join('')

export function MapFigure({
  meta,
  overlay,
  outline,
  compare,
}: {
  meta: MapMeta
  overlay: string
  outline: GeoJSON.Geometry | null
  compare: GeoJSON.Geometry | null
}) {
  const [land, setLand] = useState<string>('')
  useEffect(() => {
    fetch('/countries.json')
      .then((r) => r.json())
      .then((fc: GeoJSON.FeatureCollection) => setLand(fc.features.map((f) => (f.geometry ? pathOf(f.geometry) : '')).join('')))
  }, [])
  const y0 = py(LAT_TOP)
  const h = py(LAT_BOTTOM) - y0
  return (
    <svg viewBox={`0 ${y0.toFixed(0)} ${W} ${h.toFixed(0)}`} className="report-map" role="img">
      <rect x={0} y={y0} width={W} height={h} fill="#e9eef2" />
      <path d={land} fill="#f7f6f3" stroke="none" />
      <image href={overlay} x={0} y={0} width={W} height={W} preserveAspectRatio="none" style={{ imageRendering: 'pixelated' }} />
      <path d={land} fill="none" stroke="#6e6c66" strokeWidth={0.5} />
      {compare && <path d={pathOf(compare)} fill="none" stroke="#a8471a" strokeWidth={2} strokeDasharray="6 4" />}
      {outline && <path d={pathOf(outline)} fill="none" stroke="#0b0b0b" strokeWidth={2.2} />}
      <title>{meta.variable}</title>
    </svg>
  )
}

/** Printable report of the current view (/report?same parameters as the map). "Save as PDF" is the browser's print. */
export function Report() {
  const { t, l, num, unit, lang } = useI18n()
  const view = useMemo(() => readView(), [])
  const [variable, setVariable] = useState<Variable | null>(null)
  const [main, setMain] = useState<Series | null>(null)
  const [other, setOther] = useState<Series | null>(null)
  const [meta, setMeta] = useState<MapMeta | null>(null)
  const [outline, setOutline] = useState<GeoJSON.Geometry | null>(null)
  const [compareOutline, setCompareOutline] = useState<GeoJSON.Geometry | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    applyTheme('light')
    document.title = 'TerraScope · report'
    const vid = view.variable ?? 't2m'
    api
      .catalog()
      .then((c) => setVariable(c.variables.find((v) => v.id === vid) ?? null))
      .catch(() => {})
    const target: Target = view.area
      ? { kind: 'area', polygon: { type: 'Polygon', coordinates: [[...view.area, view.area[0]]] } }
      : view.point
        ? { kind: 'point', point: view.point }
        : { kind: 'region', region: { region_id: view.region ?? 'global' } as Region, terrain: view.terrain }
    api
      .series(vid, target, view.from)
      .then(setMain)
      .catch((e) => setError(String(e.message ?? e)))
    if (view.compare) {
      api
        .series(vid, { kind: 'region', region: { region_id: view.compare } as Region }, view.from)
        .then(setOther)
        .catch(() => {})
      api
        .geometry(view.compare)
        .then(setCompareOutline)
        .catch(() => {})
    }
    api
      .mapMeta(vid, view.from)
      .then(setMeta)
      .catch(() => {})
    if (view.region && view.region !== 'global' && !view.point)
      api
        .geometry(view.region)
        .then(setOutline)
        .catch(() => {})
  }, [view])

  const nameOf = (s: Series) =>
    s.territory.kind === 'point' && s.territory.cell
      ? t('panel.point', { lat: num(s.territory.cell[1], 1), lon: num(s.territory.cell[0], 1) })
      : l(s.territory.name)
  const mapUrl = useMemo(() => `${location.origin}/?${viewQuery({ ...view, simple: null })}`, [view])

  if (error)
    return (
      <div className="report">
        <p className="error">{t('err.load', { msg: error })}</p>
      </div>
    )
  if (!main)
    return (
      <div className="report">
        <p className="muted">{t('report.loading')}</p>
      </div>
    )

  const pText = (p: number | undefined) => (p === undefined ? '·' : p < 0.001 ? `< ${num(0.001, 3)}` : num(p, 3))
  const block = (s: Series) => {
    const r = s.rate ? shownRate(s) : null
    return (
      <section className="report-block" key={s.territory.region_id ?? 'point'}>
        <h2>{nameOf(s)}</h2>
        <div className="report-plain">
          {plainVerdict(s, nameOf(s), t, num, l, unit).map((x, i) => (
            <p key={i}>{x}</p>
          ))}
        </div>
        <table className="report-table">
          <tbody>
            {r && (
              <tr>
                <th>{t('report.rate')}</th>
                <td>
                  <b>
                    {num(r.rate.per_decade, r.decimals, true)} {unit(r.units)}
                  </b>{' '}
                  {t('rate.perDecade')} · {t('rate.ci', { lo: num(r.rate.lo, r.decimals, true), hi: num(r.rate.hi, r.decimals, true) })}
                </td>
              </tr>
            )}
            {s.total_change !== undefined && (
              <tr>
                <th>{t('report.total')}</th>
                <td>
                  {num(s.total_change, s.variable.decimals, true)} {unit(s.variable.units)} · {t('report.years', { n: s.n_years })}
                </td>
              </tr>
            )}
            <tr>
              <th>{t('report.mean')}</th>
              <td>
                {num(s.mean, s.variable.decimals)} {unit(s.variable.units)}
              </td>
            </tr>
            <tr>
              <th>{t('report.verdict')}</th>
              <td>
                {t(`verdict.${s.verdict}`)}
                {s.robustness?.checks && s.verdict.startsWith('significant')
                  ? ` · ${t(s.robustness.robust ? 'robust.yes' : 'robust.no')}`
                  : ''}
              </td>
            </tr>
            {s.tests && (
              <>
                <tr>
                  <th>{t('report.ttest')}</th>
                  <td>
                    p {pText(s.tests.t_test.p)} ·{' '}
                    {t('tests.neff', { n: s.n_months, e: num(s.tests.t_test.n_eff, 0), r: num(s.tests.t_test.r1, 2) })}
                  </td>
                </tr>
                <tr>
                  <th>{t('report.mk')}</th>
                  <td>p {pText(s.tests.mann_kendall.p)}</td>
                </tr>
              </>
            )}
            {s.sen &&
              r &&
              (() => {
                // the same units as the rate: % of the mean for "relative" variables
                const k = r.units === '%' && s.mean ? 100 / Math.abs(s.mean) : 1
                return (
                  <tr>
                    <th>{t('report.sen')}</th>
                    <td>
                      {num(s.sen.per_decade * k, r.decimals, true)} ({num(s.sen.lo * k, r.decimals, true)} …{' '}
                      {num(s.sen.hi * k, r.decimals, true)}) {unit(r.units)} {t('rate.perDecade')}
                    </td>
                  </tr>
                )
              })()}
            {s.robustness?.checks && (
              <tr>
                <th>{t('robust.title')}</th>
                <td>
                  {[
                    ['halves', t('report.rHalves')],
                    ['drop_start', t('report.rStart')],
                    ['drop_end', t('report.rEnd')],
                    ['no_step', t('report.rStep')],
                  ].map(([k, label], i) => (
                    <span key={k}>
                      {i ? ' · ' : ''}
                      <Mark ok={Boolean(s.robustness?.checks?.[k as 'halves'])} /> {label}
                    </span>
                  ))}
                </td>
              </tr>
            )}
            {s.second_opinion.map((tw) => (
              <tr key={tw.id}>
                <th>{t('twin.title')}</th>
                <td>
                  <Mark ok={tw.agrees} /> {l(tw.name)} ({tw.source}): {num(tw.per_decade, tw.decimals, true)} {unit(tw.units)}{' '}
                  {t('rate.perDecade')}, {t(`verdict.${tw.verdict}`)}, {tw.years[0]} {t('word.to')} {tw.years[1]}
                </td>
              </tr>
            ))}
            {s.change_point?.is_step && (
              <tr>
                <th>{t('report.step')}</th>
                <td>
                  {t('cp.step', {
                    v: `${num(s.change_point.shift, s.variable.decimals, true)} ${unit(s.variable.units)}`,
                    year: s.change_point.year,
                  })}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    )
  }

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
            onClick={() => download(fileName(main, 'csv'), seriesCsv(main, nameOf(main), other, other ? nameOf(other) : ''))}
          >
            {t('report.csv')}
          </button>
          <a className="btn" href={mapUrl}>
            {t('report.back')}
          </a>
        </div>
        <header className="report-head">
          <div className="report-brand">TerraScope · {t('report.kind')}</div>
          <h1>
            {l(main.variable.name)}
            {other ? ` · ${nameOf(main)} ${t('report.vs')} ${nameOf(other)}` : ` · ${nameOf(main)}`}
          </h1>
          <div className="muted">
            {t('report.meta', {
              a: main.period.start,
              b: main.period.end,
              src: main.variable.source,
              cells: main.territory.cells_with_data,
              date: new Date().toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
            })}
          </div>
          {variable && <p className="report-hint">{l(variable.hint)}</p>}
        </header>

        {block(main)}
        {other && block(other)}

        <section className="report-block report-chart">
          <h2>{t('report.chart')}</h2>
          <TrendChart main={main} other={other} mainName={nameOf(main)} otherName={other ? nameOf(other) : ''} />
          {!other && <OutlookNote s={main} />}
        </section>

        {meta && (
          <section className="report-block">
            <h2>
              {meta.units
                ? t('report.map', { units: unit(meta.units), a: meta.years[0], b: meta.years[1] })
                : t('report.mapNoUnits', { a: meta.years[0], b: meta.years[1] })}
            </h2>
            <MapFigure meta={meta} overlay={api.mapUrl(main.variable.id, view.from, false)} outline={outline} compare={compareOutline} />
            <div className="report-legend">
              <span>{num(-meta.scale, meta.scale < 1 ? 2 : 1, true)}</span>
              <div className="legend-bar" style={{ background: `linear-gradient(to right, ${meta.colors.join(', ')})` }} />
              <span>{num(meta.scale, meta.scale < 1 ? 2 : 1, true)}</span>
            </div>
            <p className="muted small">
              {t('legend.sig')}{' '}
              {t('legend.share', {
                total: num((meta.share_sig_up + meta.share_sig_down) * 100, 0),
                up: num(meta.share_sig_up * 100, 0),
                down: num(meta.share_sig_down * 100, 0),
              })}
            </p>
          </section>
        )}

        <section className="report-block report-method">
          <h2>{t('report.method')}</h2>
          <p>{t('report.methodText')}</p>
          <h2>{t('report.sources')}</h2>
          <p>{t('report.sourcesText')}</p>
          <p className="muted small">{t('report.link', { url: mapUrl })}</p>
        </section>
      </div>
    </ThemeContext.Provider>
  )
}
