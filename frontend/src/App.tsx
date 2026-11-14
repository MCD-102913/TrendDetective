import type { Map as MLMap } from 'maplibre-gl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type Catalog,
  type ChainKey,
  type ChainSummary,
  type Discoveries,
  type FoundPair,
  type MapLayer,
  type MapMeta,
  type Region,
  type RuleCard,
  type Series,
  type SpaceLayer,
  type Target,
  type Variable,
} from './api'
import { CASES, type Case } from './cases'
import { ComparePanel } from './components/ComparePanel'
import { ChainPanel, FoundPanel } from './components/Found'
import { Icon } from './components/Icon'
import { MapView } from './components/MapView'
import { Method } from './components/Method'
import { Nav } from './components/PageShell'
import { RegionSearch } from './components/RegionSearch'
import { RuleBuilder, type SessionRule } from './components/RuleBuilder'
import { RulePanel } from './components/RulePanel'
import { ScanPanel } from './components/ScanPanel'
import { SimplePanel } from './components/SimplePanel'
import { TOUR_DONE_KEY, Tour } from './components/Tour'
import { TrendPanel } from './components/TrendPanel'
import { download, fileName, seriesCsv } from './csv'
import { useI18n } from './i18n'
import { QUESTIONS } from './questions'
import { applyTheme, detectTheme, type Theme, ThemeContext } from './theme'
import { readView, viewQuery, writeView } from './urlState'
import './App.css'

const DEFAULT_VARIABLE = 't2m'
const GLOBAL: Region = {
  region_id: 'global',
  level: -1,
  name: { en: 'Whole Earth', ru: 'Вся Земля' },
  parent_name: null,
  bbox: [-180, -90, 180, 90],
}

const INITIAL = readView()

// a sensible second variable when compare mode is switched on
const PAIR: Record<string, string> = {
  precip_gpm: 'gldas_evap',
  gldas_evap: 'precip_gpm',
  precip_merra: 'evland',
  evland: 'precip_merra',
  ndvi: 'precip_gpm',
  evi: 'precip_gpm',
  soil_root: 'precip_merra',
  gldas_root: 'precip_gpm',
  gldas_soil: 'precip_gpm',
  aod: 'sw_down',
  sw_down: 'aod',
  cloud: 'sw_down',
  t2m_max: 'sw_down',
  t2m: 'airs_tair',
  airs_tair: 't2m',
  chl: 'ts_ocean',
  ts_ocean: 'chl',
  omi_no2: 'aod',
  sea_ice: 't2m',
  snow_depth: 't2m',
  lst_day: 'ndvi',
}
const savedSimple = () => {
  try {
    // first visit: the simple view; a choice made once is remembered
    return (localStorage.getItem('view') ?? 'simple') === 'simple'
  } catch {
    return false
  }
}

export default function App() {
  const { t, l, lang, setLang, num, unit } = useI18n()
  const [theme, setThemeState] = useState<Theme>(() => {
    const th = detectTheme()
    applyTheme(th)
    return th
  })
  const setTheme = useCallback((th: Theme) => {
    applyTheme(th)
    localStorage.setItem('theme', th)
    setThemeState(th)
  }, [])

  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [variableId, setVariableId] = useState(INITIAL.variable ?? DEFAULT_VARIABLE)
  const [variable2Id, setVariable2Id] = useState<string | null>(INITIAL.variable2)
  const [startYear, setStartYear] = useState<number | null>(INITIAL.from)
  const [sigOnly, setSigOnly] = useState(false)
  const [target, setTarget] = useState<Target>(INITIAL.point ? { kind: 'point', point: INITIAL.point } : { kind: 'region', region: GLOBAL })
  const [compare, setCompare] = useState<Region | null>(null)
  const [outline, setOutline] = useState<GeoJSON.Geometry | null>(null)
  const [compareOutline, setCompareOutline] = useState<GeoJSON.Geometry | null>(null)
  const [fitTo, setFitTo] = useState<number[] | null>(null)
  const [main, setMain] = useState<Series | null>(null)
  const [other, setOther] = useState<Series | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<MapMeta | null>(null)
  const [mapLoading, setMapLoading] = useState(false)
  const [methodOpen, setMethodOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [rules, setRules] = useState<RuleCard[]>([])
  const [rule, setRule] = useState<RuleCard | null>(null)
  // hypotheses of this visitor: kept in sessionStorage (gone when the tab is closed), never on the server
  const [sessionRules, setSessionRules] = useState<SessionRule[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('sessionRules') ?? '[]')
    } catch {
      return []
    }
  })
  const [builderOpen, setBuilderOpen] = useState(false)
  // the exhaustive search: top pairs in the list, one pair opened on the map, a link sent to the relation card
  const [found, setFound] = useState<Discoveries | null>(null)
  const [foundPair, setFoundPair] = useState<FoundPair | null>(null)
  const [foundAll, setFoundAll] = useState(false)
  const [chains, setChains] = useState<ChainSummary[]>([])
  const [chain, setChain] = useState<ChainKey | null>(null)
  const [chainsAll, setChainsAll] = useState(false)
  const [relPreset, setRelPreset] = useState<{ id: string; n: number } | null>(null)
  useEffect(() => {
    try {
      // results are recomputed (from the server cache) after a reload: the rules are stored, not the results
      sessionStorage.setItem('sessionRules', JSON.stringify(sessionRules.map((r) => ({ ...r, result: { ...r.result, territories: [] } }))))
    } catch {
      /* storage blocked: the rules live until the page is reloaded */
    }
  }, [sessionRules])
  const [simple, setSimpleState] = useState<boolean>(INITIAL.simple ?? savedSimple())
  const [globe, setGlobe] = useState(INITIAL.globe)
  const [layer, setLayer] = useState<MapLayer>(INITIAL.layer ?? 'trend')
  const [space, setSpace] = useState<SpaceLayer | null>(null)
  const [spaceB, setSpaceB] = useState<SpaceLayer | null>(null)
  // the simple view knows only the trend and the picture from space
  const shownLayer: MapLayer = simple && (layer === 'normal' || layer === 'last') ? 'trend' : layer
  const dataLayer = shownLayer === 'space' ? 'trend' : shownLayer
  const [tourOpen, setTourOpen] = useState(false)
  const [metaB, setMetaB] = useState<MapMeta | null>(null)
  const [seriesB, setSeriesB] = useState<Series | null>(null)
  const [mapLoadingB, setMapLoadingB] = useState(false)
  const setSimple = useCallback((v: boolean) => {
    try {
      localStorage.setItem('view', v ? 'simple' : 'detailed')
    } catch {
      /* storage blocked */
    }
    setSimpleState(v)
    if (v) {
      // the simple view answers one question about one place: no second map, rules, scan or custom period
      setVariable2Id(null)
      setRule(null)
      setScanOpen(false)
      setFoundPair(null)
      setChain(null)
      setStartYear(null)
    }
  }, [])

  useEffect(() => {
    api
      .catalog()
      .then(setCatalog)
      .catch((e) => setError(String(e.message ?? e)))
    api
      .rules()
      .then((r) => setRules(r.rules))
      .catch(() => setRules([]))
    api
      .found(40)
      .then(setFound)
      .catch(() => setFound(null))
    api
      .chains(30)
      .then((r) => setChains(r.chains))
      .catch(() => setChains([]))
  }, [])

  const variable: Variable | null = useMemo(
    () => catalog?.variables.find((v) => v.id === variableId) ?? catalog?.variables[0] ?? null,
    [catalog, variableId],
  )

  const variable2: Variable | null = useMemo(
    () => (variable2Id ? (catalog?.variables.find((v) => v.id === variable2Id) ?? null) : null),
    [catalog, variable2Id],
  )

  // start years offered: the variable's own start, then round decades that leave at least 15 years
  const startOptions = useMemo(() => {
    if (!variable) return []
    const first = Number(variable.start.slice(0, 4))
    const last = Number(variable.end.slice(0, 4))
    const out = [first]
    for (let y = Math.ceil((first + 1) / 5) * 5; y <= last - 15; y += 5) out.push(y)
    return out
  }, [variable])
  const effectiveStart = startYear && startOptions.includes(startYear) && startYear !== startOptions[0] ? startYear : null

  // trend map
  useEffect(() => {
    if (!variable) return
    const ctrl = new AbortController()
    setMapLoading(true)
    api
      .mapMeta(variable.id, effectiveStart, ctrl.signal, dataLayer)
      .then(setMeta)
      .catch(() => {})
    return () => ctrl.abort()
  }, [variable, effectiveStart, dataLayer])
  const overlayUrl =
    variable && meta?.variable === variable.id && meta.layer === dataLayer
      ? dataLayer === 'trend'
        ? `${api.mapUrl(variable.id, effectiveStart, !simple && sigOnly)}${simple ? '&simple=true' : ''}`
        : api.mapUrl(variable.id, null, false, dataLayer)
      : null
  // NASA imagery for the variable(s) on the map
  useEffect(() => {
    if (shownLayer !== 'space' || !variable) return setSpace(null)
    const ctrl = new AbortController()
    api
      .space(variable.id, ctrl.signal)
      .then(setSpace)
      .catch(() => setSpace(null))
    return () => ctrl.abort()
  }, [shownLayer, variable])
  useEffect(() => {
    if (shownLayer !== 'space' || !variable2) return setSpaceB(null)
    const ctrl = new AbortController()
    api
      .space(variable2.id, ctrl.signal)
      .then(setSpaceB)
      .catch(() => setSpaceB(null))
    return () => ctrl.abort()
  }, [shownLayer, variable2])

  // compare mode: the second variable on the same territory
  useEffect(() => {
    if (!variable2) {
      setMetaB(null)
      setSeriesB(null)
      return
    }
    const ctrl = new AbortController()
    setMapLoadingB(true)
    api
      .mapMeta(variable2.id, effectiveStart, ctrl.signal, dataLayer)
      .then(setMetaB)
      .catch(() => {})
    api
      .series(variable2.id, target, effectiveStart, ctrl.signal)
      .then(setSeriesB)
      .catch((e) => {
        if (e.name !== 'AbortError') setSeriesB(null)
      })
    return () => ctrl.abort()
  }, [variable2, target, effectiveStart, dataLayer])
  // the two maps must show different variables: if A becomes B, pick another B
  useEffect(() => {
    if (!variable2Id || variable2Id !== variable?.id) return
    const alt =
      PAIR[variable2Id] && PAIR[variable2Id] !== variable2Id ? PAIR[variable2Id] : catalog?.variables.find((v) => v.id !== variable2Id)?.id
    setVariable2Id(alt ?? null)
  }, [variable2Id, variable, catalog])
  const overlayUrlB =
    variable2 && metaB?.variable === variable2.id && metaB.layer === dataLayer
      ? dataLayer === 'trend'
        ? `${api.mapUrl(variable2.id, effectiveStart, !simple && sigOnly)}${simple ? '&simple=true' : ''}`
        : api.mapUrl(variable2.id, null, false, dataLayer)
      : null

  // two maps move together: whichever the user drags, the other follows
  const maps = useRef<(MLMap | null)[]>([null, null])
  const syncing = useRef(false)
  const registerMap = useCallback(
    (i: number) => (map: MLMap | null) => {
      maps.current[i] = map
      if (!map) return
      const other = maps.current[1 - i]
      if (other) map.jumpTo({ center: other.getCenter(), zoom: other.getZoom(), bearing: other.getBearing(), pitch: other.getPitch() })
      map.on('move', () => {
        const peer = maps.current[1 - i]
        if (syncing.current || !peer) return
        syncing.current = true
        peer.jumpTo({ center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() })
        syncing.current = false
      })
    },
    [],
  )
  const registerA = useMemo(() => registerMap(0), [registerMap])
  const registerB = useMemo(() => registerMap(1), [registerMap])

  const toggleCompareVars = useCallback(() => {
    if (variable2Id) {
      setVariable2Id(null)
      return
    }
    const first = variable?.id ?? variableId
    const pick =
      PAIR[first] && catalog?.variables.some((v) => v.id === PAIR[first])
        ? PAIR[first]
        : (catalog?.variables.find((v) => v.id !== first)?.id ?? null)
    setVariable2Id(pick)
    setCompare(null)
    setCompareOutline(null)
    setRule(null)
    setScanOpen(false)
  }, [variable2Id, variable, variableId, catalog])

  // series for the main territory
  useEffect(() => {
    if (!variable) return
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    api
      .series(variable.id, target, effectiveStart, ctrl.signal)
      .then((s) => {
        setMain(s)
        setLoading(false)
      })
      .catch((e) => {
        if (e.name === 'AbortError') return
        setMain(null)
        setError(String(e.message ?? e))
        setLoading(false)
      })
    return () => ctrl.abort()
  }, [variable, target, effectiveStart])

  // series for the comparison territory
  useEffect(() => {
    if (!variable || !compare) {
      setOther(null)
      return
    }
    const ctrl = new AbortController()
    api
      .series(variable.id, { kind: 'region', region: compare }, effectiveStart, ctrl.signal)
      .then(setOther)
      .catch(() => setOther(null))
    return () => ctrl.abort()
  }, [variable, compare, effectiveStart])

  const pickRegion = useCallback((r: Region) => {
    setTarget({ kind: 'region', region: r })
    // comparing a territory with itself is meaningless
    setCompare((c) => {
      if (c?.region_id === r.region_id) setCompareOutline(null)
      return c?.region_id === r.region_id ? null : c
    })
    setFitTo(r.bbox)
    if (r.level < 0 && r.region_id === 'global') setOutline(null)
    else
      api
        .geometry(r.region_id)
        .then(setOutline)
        .catch(() => setOutline(null))
  }, [])

  const pickCompare = useCallback((r: Region | null) => {
    setCompare(r)
    if (!r || r.region_id === 'global') setCompareOutline(null)
    else
      api
        .geometry(r.region_id)
        .then(setCompareOutline)
        .catch(() => setCompareOutline(null))
  }, [])

  const pickPoint = useCallback((lon: number, lat: number) => {
    setTarget({ kind: 'point', point: [lon, lat] })
    setOutline(null)
  }, [])

  const openCase = useCallback(
    async (c: Case) => {
      setVariableId(c.variable)
      setStartYear(null)
      setSigOnly(false)
      try {
        const [a, b] = await Promise.all([api.region(c.region), c.compare ? api.region(c.compare) : Promise.resolve(null)])
        pickRegion(a)
        pickCompare(b)
      } catch (e) {
        setError(String((e as Error).message ?? e))
      }
    },
    [pickRegion, pickCompare],
  )

  // restore the territory and the comparison from the link once
  useEffect(() => {
    if (INITIAL.region && !INITIAL.point)
      api
        .region(INITIAL.region)
        .then(pickRegion)
        .catch(() => {})
    // nothing asked for in the link: the simple view opens on the visitor's own country
    else if (!INITIAL.point && (INITIAL.simple ?? savedSimple()))
      api
        .home()
        .then((h) => (h.region_id ? api.region(h.region_id).then(pickRegion) : undefined))
        .catch(() => {})
    if (INITIAL.compare)
      api
        .region(INITIAL.compare)
        .then(pickCompare)
        .catch(() => {})
    // a hypothesis made on the links page opens here
    const rid = new URLSearchParams(location.search).get('rule')
    const s = rid ? sessionRules.find((x) => x.id === rid) : null
    if (s) setRule(s.result)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickRegion, pickCompare])

  // keep the address bar in sync with the view
  const viewState = useMemo(
    () => ({
      variable: variable?.id ?? variableId,
      variable2: variable2?.id ?? null,
      region: target.kind === 'region' ? target.region.region_id : null,
      point: target.kind === 'point' ? target.point : null,
      compare: compare?.region_id ?? null,
      from: effectiveStart,
      simple,
      globe,
      layer: layer === 'trend' ? null : layer,
    }),
    [variable, variableId, variable2, target, compare, effectiveStart, simple, globe, layer],
  )
  useEffect(() => writeView(viewState), [viewState])

  // the guide opens by itself on the first visit, once there is a verdict to point at
  useEffect(() => {
    if (!main) return
    try {
      if (!localStorage.getItem(TOUR_DONE_KEY)) setTourOpen(true)
    } catch {
      /* storage blocked: no automatic guide */
    }
  }, [main])

  const openReport = useCallback(() => window.open(`/report?${viewQuery(viewState)}`, '_blank'), [viewState])

  const groups = useMemo(() => {
    if (!catalog) return []
    return Object.entries(catalog.spheres)
      .map(([id, name]) => ({ id, name, items: catalog.variables.filter((v) => v.sphere === id) }))
      .filter((g) => g.items.length)
  }, [catalog])

  const pct = (x: number) => num(x * 100, 0)
  const swapAB = useCallback(() => {
    if (!variable || !variable2) return
    const a = variable.id
    setVariableId(variable2.id)
    setVariable2Id(a)
  }, [variable, variable2])

  // a variable selector grouped by sphere, for the map headers in compare mode
  const VarSelect = ({
    value,
    onChange,
    exclude,
    label,
  }: {
    value: string
    onChange: (id: string) => void
    exclude?: string
    label: string
  }) => (
    <select className="var-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} title={label}>
      {groups.map((g) => (
        <optgroup key={g.id} label={l(g.name)}>
          {g.items
            .filter((v) => v.id !== exclude)
            .map((v) => (
              <option key={v.id} value={v.id}>
                {l(v.name)} · {v.source}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  )

  const spaceLegend = (sp: SpaceLayer | null) => (
    <div className="legend">
      {!sp ? (
        <div className="muted small">{t('layer.spaceLoading')}</div>
      ) : (
        <>
          <div className="legend-title">
            {sp.title} · {sp.date}
          </div>
          {sp.legend && <img className="space-legend" src={sp.legend} alt="" />}
          <div className="muted small">{t(sp.true_color ? 'layer.spaceTrue' : 'layer.spaceNote')}</div>
          <a className="small" href={sp.worldview} target="_blank" rel="noreferrer">
            {t('layer.worldview')}
          </a>
        </>
      )}
    </div>
  )

  const fieldLegend = (v: Variable, m: MapMeta) => {
    const d = m.units === '%' ? 0 : Math.min(v.decimals, 2)
    const u = m.units ? `, ${unit(m.units)}` : ''
    if (m.layer === 'normal') {
      const val = (x: number) => num(m.log ? 10 ** x : x, m.log ? 2 : d)
      return (
        <div className="legend">
          <div className="legend-title">{t('layer.normalTitle', { what: l(v.name), a: m.years[0], b: m.years[1], u })}</div>
          <div className="legend-bar" style={{ background: `linear-gradient(to right, ${m.colors.join(', ')})` }} />
          <div className="legend-ticks">
            <span>{val(m.lo ?? 0)}</span>
            <span>{val(m.hi ?? 1)}</span>
          </div>
          <div className="muted small">{t(m.log ? 'layer.normalNoteLog' : 'layer.normalNote')}</div>
        </div>
      )
    }
    return (
      <div className="legend">
        <div className="legend-title">{t('layer.lastTitle', { what: l(v.name), year: m.year ?? '', u })}</div>
        <div className="legend-bar" style={{ background: `linear-gradient(to right, ${m.colors.join(', ')})` }} />
        <div className="legend-ticks">
          <span>
            {num(-m.scale, m.scale < 1 ? 2 : d, true)} {t('layer.below')}
          </span>
          <span>0</span>
          <span>
            {t('layer.above')} {num(m.scale, m.scale < 1 ? 2 : d, true)}
          </span>
        </div>
        <div className="small">{t('layer.lastShare', { p: pct(m.share_above ?? 0) })}</div>
        <div className="muted small">{t('layer.lastNote')}</div>
      </div>
    )
  }

  const legendFor = (v: Variable, m: MapMeta) =>
    m.layer !== 'trend' ? (
      fieldLegend(v, m)
    ) : simple ? (
      <div className="legend">
        <div className="legend-title">{t('legend.simpleTitle', { what: l(v.name), a: m.years[0], b: m.years[1] })}</div>
        <div className="legend-swatches">
          <span>
            <i style={{ background: m.colors[m.colors.length - 1] }} />
            {t('legend.simpleUp')}
          </span>
          <span>
            <i style={{ background: m.colors[0] }} />
            {t('legend.simpleDown')}
          </span>
          <span>
            <i className="neutral" />
            {t('legend.simpleNone')}
          </span>
        </div>
        <div className="small">
          {t('legend.share', { total: pct(m.share_sig_up + m.share_sig_down), up: pct(m.share_sig_up), down: pct(m.share_sig_down) })}
        </div>
        {!variable2 && <div className="muted small">{t('map.hint')}</div>}
      </div>
    ) : (
      <div className="legend">
        <div className="legend-title">
          {l(v.name)}.{' '}
          {m.units
            ? t('legend.title', { units: unit(m.units), a: m.years[0], b: m.years[1] })
            : t('legend.titleNoUnits', { a: m.years[0], b: m.years[1] })}
        </div>
        <div className="legend-bar" style={{ background: `linear-gradient(to right, ${m.colors.join(', ')})` }} />
        <div className="legend-ticks">
          <span>
            {num(-m.scale, m.scale < 1 ? 2 : 1, true)} {t('legend.down')}
          </span>
          <span>0</span>
          <span>
            {t('legend.up')} {num(m.scale, m.scale < 1 ? 2 : 1, true)}
          </span>
        </div>
        {!variable2 && <div className="muted small">{t('legend.sig')}</div>}
        <div className="small">
          {t('legend.share', { total: pct(m.share_sig_up + m.share_sig_down), up: pct(m.share_sig_up), down: pct(m.share_sig_down) })}
        </div>
        {!variable2 && <div className="muted small">{t('map.hint')}</div>}
      </div>
    )

  // a found link or chain checked as a session hypothesis
  const tryFound = async (yaml: string) => {
    const r = await api.tryRule(yaml)
    if ('errors' in r) return setError(r.errors.join('; '))
    setSessionRules((rs) => [...rs.filter((x) => x.id !== r.id), { id: r.id, yaml, result: r }])
    setFoundPair(null)
    setChain(null)
    setRule(r)
  }

  const nameOf = useCallback(
    (s: Series) =>
      s.territory.kind === 'point' && s.territory.cell
        ? t('panel.point', { lat: num(s.territory.cell[1], 1), lon: num(s.territory.cell[0], 1) })
        : l(s.territory.name),
    [t, l, num],
  )

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <h1>{t('app.title')}</h1>
            <span className="muted tagline">{t('app.tagline')}</span>
          </div>
          <div className="topbar-right">
            {!simple && <Nav active="map" variable={variable?.id} region={target.kind === 'region' ? target.region.region_id : null} />}
            <div className="view-tools">
              <div className="seg" role="group" aria-label={t('view.title')}>
                <button type="button" className={`btn ${simple ? 'on' : ''}`} aria-pressed={simple} onClick={() => setSimple(true)}>
                  {t('view.simple')}
                </button>
                <button type="button" className={`btn ${!simple ? 'on' : ''}`} aria-pressed={!simple} onClick={() => setSimple(false)}>
                  {t('view.detailed')}
                </button>
              </div>
              <button type="button" className={`btn ${globe ? 'on' : ''}`} aria-pressed={globe} onClick={() => setGlobe((g) => !g)}>
                {globe ? t('map.flat') : t('map.globe')}
              </button>
            </div>
            {!simple && (
              <button type="button" className={`btn ${variable2 ? 'on' : ''}`} aria-pressed={!!variable2} onClick={toggleCompareVars}>
                {variable2 ? t('cmp.exit') : t('cmp.enter')}
              </button>
            )}
            <button type="button" className="btn" onClick={() => setTourOpen(true)}>
              {t('tour.open')}
            </button>
            <button type="button" className="btn" onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')} aria-label="Language">
              {lang === 'ru' ? 'EN' : 'RU'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={t('theme.toggle')}
              title={t('theme.toggle')}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
            </button>
          </div>
        </header>

        <aside className="picker">
          {simple ? (
            <>
              <h2 className="step">{t('simple.ask')}</h2>
              <ul className="questions">
                {QUESTIONS.filter((q) => catalog?.variables.some((v) => v.id === q.variable)).map((q) => (
                  <li key={q.id}>
                    <button
                      type="button"
                      className={`question ${q.variable === variable?.id ? 'active' : ''}`}
                      onClick={() => setVariableId(q.variable)}
                    >
                      <span className="q-icon" aria-hidden>
                        <Icon name={q.icon} />
                      </span>
                      <span>{l(q.title)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="muted small">{t('simple.allHint', { n: catalog?.variables.length ?? 0 })}</p>
              <button type="button" className="btn wide" onClick={() => setSimple(false)}>
                {t('simple.more')}
              </button>
            </>
          ) : (
            <>
              <section className="cases">
                <h3 title={t('cases.hint')}>{t('cases.title')}</h3>
                <ul>
                  {CASES.filter((c) => catalog?.variables.some((v) => v.id === c.variable)).map((c) => (
                    <li key={c.id}>
                      <button type="button" className="case" onClick={() => openCase(c)}>
                        {l(c.title)}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="cases">
                <h3 title={t('rule.hint')}>{t('rule.title')}</h3>
                <ul>
                  {rules.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        className={`case ${rule?.id === r.id ? 'active' : ''}`}
                        title={r.description ? l(r.description) : ''}
                        onClick={() => {
                          setRule(rule?.id === r.id ? null : r)
                          setScanOpen(false)
                        }}
                      >
                        {l(r.name)}
                      </button>
                    </li>
                  ))}
                  {sessionRules.map((s) => (
                    <li key={s.id} className="case-row">
                      <button
                        type="button"
                        className={`case mine ${rule?.id === s.id ? 'active' : ''}`}
                        onClick={() => {
                          setRule(rule?.id === s.id ? null : s.result)
                          setScanOpen(false)
                          setVariable2Id(null)
                        }}
                      >
                        <span className="rb-mine">{t('rb.mine')}</span>
                        {l(s.result.name)}
                      </button>
                      <button
                        type="button"
                        className="btn case-x"
                        aria-label={t('compare.remove')}
                        title={t('compare.remove')}
                        onClick={() => {
                          setSessionRules((rs) => rs.filter((x) => x.id !== s.id))
                          if (rule?.id === s.id) setRule(null)
                        }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" className="btn wide rb-open" onClick={() => setBuilderOpen(true)}>
                  {t('rb.open')}
                </button>
              </section>
              {found && found.pairs.length > 0 && (
                <section className="cases">
                  <h3 title={t('found.hint')}>{t('found.title')}</h3>
                  <p className="muted small">{t('found.listHint', { n: num(found.counts.found, 0), m: num(found.counts.tests, 0) })}</p>
                  <ul>
                    {found.pairs.slice(0, foundAll ? 40 : 6).map((p) => (
                      <li key={`${p.a}-${p.b}`}>
                        <button
                          type="button"
                          className={`case ${foundPair?.a === p.a && foundPair.b === p.b ? 'active' : ''}`}
                          onClick={() => {
                            setFoundPair(foundPair?.a === p.a && foundPair.b === p.b ? null : p)
                            setChain(null)
                            setRule(null)
                            setScanOpen(false)
                          }}
                        >
                          {l(p.a_name)} ↔ {l(p.b_name)}{' '}
                          <span className="muted small">
                            · {p.found}
                            {p.kind !== 'independent' ? ` · ${t(`found.kindShort.${p.kind}`)}` : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {found.pairs.length > 6 && (
                    <button type="button" className="btn wide" onClick={() => setFoundAll((v) => !v)}>
                      {foundAll ? t('found.less') : t('found.more')}
                    </button>
                  )}
                </section>
              )}
              {chains.length > 0 && (
                <section className="cases">
                  <h3 title={t('chain.hint')}>{t('chain.title')}</h3>
                  <p className="muted small">{t('chain.listHint')}</p>
                  <ul>
                    {chains.slice(0, chainsAll ? 30 : 6).map((c) => {
                      const on = chain?.a === c.a && chain.b === c.b && chain.c === c.c
                      return (
                        <li key={`${c.a}-${c.b}-${c.c}`}>
                          <button
                            type="button"
                            className={`case ${on ? 'active' : ''}`}
                            onClick={() => {
                              setChain(on ? null : { a: c.a, b: c.b, c: c.c })
                              setFoundPair(null)
                              setRule(null)
                              setScanOpen(false)
                            }}
                          >
                            {l(c.a_name)} → {l(c.b_name)} → {l(c.c_name)}{' '}
                            <span className="muted small">
                              · {c.countries}
                              {c.kind !== 'independent' ? ` · ${t(`found.kindShort.${c.kind}`)}` : ''}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  {chains.length > 6 && (
                    <button type="button" className="btn wide" onClick={() => setChainsAll((v) => !v)}>
                      {chainsAll ? t('found.less') : t('found.more')}
                    </button>
                  )}
                </section>
              )}
              <h2 className="step">{t('pick.title')}</h2>
              {variable2 && <p className="cmp-hint small">{t('cmp.listHint')}</p>}
              {groups.map((g) => (
                <section key={g.id}>
                  <h3>{l(g.name)}</h3>
                  <ul>
                    {g.items.map((v) => (
                      <li key={v.id}>
                        <button
                          type="button"
                          className={`var ${v.id === variable?.id ? 'active' : ''} ${v.id === variable2?.id ? 'active-b' : ''}`}
                          onClick={() => setVariableId(v.id)}
                          title={l(v.hint)}
                        >
                          <span className="var-name">
                            {variable2 && v.id === variable?.id && <span className="cmp-tag inline">A</span>}
                            {variable2 && v.id === variable2.id && <span className="cmp-tag inline b">B</span>}
                            {l(v.name)}
                          </span>
                          <span className="var-meta">
                            {v.source} · {t(catalog!.sources[v.source]?.type === 'model' ? 'pick.model' : 'pick.satellite')} ·{' '}
                            {t('pick.since', { year: v.start.slice(0, 4) })}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
          <p className="muted small about">{t('about.data')}</p>
        </aside>

        <main className="map-area">
          <div className="map-tools">
            <h2 className="step">{t('map.title')}</h2>
            <RegionSearch placeholder={t('map.search')} onPick={pickRegion} />
            {simple ? (
              <button
                type="button"
                className={`btn ${shownLayer === 'space' ? 'on' : ''}`}
                aria-pressed={shownLayer === 'space'}
                onClick={() => setLayer(shownLayer === 'space' ? 'trend' : 'space')}
              >
                {t('layer.spaceButton')}
              </button>
            ) : (
              <div className="seg" role="group" aria-label={t('layer.title')}>
                {(['trend', 'normal', 'last', 'space'] as const).map((x) => (
                  <button
                    type="button"
                    key={x}
                    className={`btn ${shownLayer === x ? 'on' : ''}`}
                    aria-pressed={shownLayer === x}
                    title={t(`layer.${x}Hint`)}
                    onClick={() => setLayer(x)}
                  >
                    {t(`layer.${x}`)}
                  </button>
                ))}
              </div>
            )}
            {!simple && shownLayer === 'trend' && (
              <label className="field">
                <span>{t('map.from')}</span>
                <select value={effectiveStart ?? startOptions[0] ?? ''} onChange={(e) => setStartYear(Number(e.target.value))}>
                  {startOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!simple && shownLayer === 'trend' && (
              <label className="check">
                <input type="checkbox" checked={sigOnly} onChange={(e) => setSigOnly(e.target.checked)} />
                <span>{t('map.sigOnly')}</span>
              </label>
            )}
            {simple ? null : variable2 ? (
              <button type="button" className="btn" onClick={swapAB} title={t('cmp.swap')}>
                ⇄ {t('cmp.swap')}
              </button>
            ) : (
              <button
                type="button"
                className={`btn ${scanOpen ? 'on' : ''}`}
                onClick={() => {
                  setScanOpen((v) => !v)
                  setRule(null)
                }}
              >
                {t('scan.open')}
              </button>
            )}
          </div>
          <div className="panes">
            <div className="pane">
              <MapView
                overlayUrl={overlayUrl}
                bounds={meta?.bounds ?? [-180, -85, 180, 85]}
                outline={outline}
                compareOutline={compareOutline}
                point={target.kind === 'point' ? target.point : null}
                fitTo={fitTo}
                onPick={pickPoint}
                onOverlayState={setMapLoading}
                globe={globe}
                onReady={registerA}
                tiles={shownLayer === 'space' && space ? { url: space.tiles, maxzoom: space.maxzoom } : null}
              />
              {variable2 && variable && (
                <div className="pane-label">
                  <span className="cmp-tag inline">A</span>
                  <VarSelect value={variable.id} onChange={setVariableId} exclude={variable2.id} label={t('cmp.pickA')} />
                </div>
              )}
              {shownLayer === 'space' ? spaceLegend(space) : variable && meta && meta.variable === variable.id && legendFor(variable, meta)}
            </div>
            {variable2 && (
              <div className="pane">
                <MapView
                  overlayUrl={overlayUrlB}
                  bounds={metaB?.bounds ?? [-180, -85, 180, 85]}
                  outline={outline}
                  compareOutline={null}
                  point={target.kind === 'point' ? target.point : null}
                  fitTo={fitTo}
                  onPick={pickPoint}
                  onOverlayState={setMapLoadingB}
                  globe={globe}
                  onReady={registerB}
                  tiles={shownLayer === 'space' && spaceB ? { url: spaceB.tiles, maxzoom: spaceB.maxzoom } : null}
                />
                <div className="pane-label">
                  <span className="cmp-tag inline b">B</span>
                  <VarSelect value={variable2.id} onChange={setVariable2Id} exclude={variable?.id} label={t('cmp.pickB')} />
                </div>
                {shownLayer === 'space' ? spaceLegend(spaceB) : metaB && metaB.variable === variable2.id && legendFor(variable2, metaB)}
              </div>
            )}
          </div>
          {(mapLoading || (variable2 && mapLoadingB)) && <div className="map-status">{t('map.loading')}</div>}
          {rule && (
            <RulePanel
              key={rule.id}
              rule={rule}
              currentRegion={target.kind === 'region' ? target.region.region_id : null}
              onPick={(r, v) => {
                setVariableId(v)
                pickRegion(r)
              }}
              onClose={() => setRule(null)}
              session={(() => {
                const s = sessionRules.find((x) => x.id === rule.id)
                return s ? { yaml: s.yaml, result: s.result.territories.length ? s.result : undefined } : undefined
              })()}
            />
          )}
          {foundPair && !rule && (
            <FoundPanel
              key={`${foundPair.a}-${foundPair.b}`}
              pair={foundPair}
              currentRegion={target.kind === 'region' ? target.region.region_id : null}
              onPick={(r, a, b) => {
                setVariableId(a)
                pickRegion(r)
                setRelPreset((p) => ({ id: b, n: (p?.n ?? 0) + 1 }))
              }}
              onClose={() => setFoundPair(null)}
              onHypothesis={tryFound}
            />
          )}
          {chain && !rule && !foundPair && (
            <ChainPanel
              key={`${chain.a}-${chain.b}-${chain.c}`}
              chain={chain}
              currentRegion={target.kind === 'region' ? target.region.region_id : null}
              onPick={(r, a, b) => {
                setVariableId(a)
                pickRegion(r)
                setRelPreset((p) => ({ id: b, n: (p?.n ?? 0) + 1 }))
              }}
              onClose={() => setChain(null)}
              onHypothesis={tryFound}
            />
          )}
          {scanOpen && variable && (
            <ScanPanel variable={variable} startYear={effectiveStart} onPick={pickRegion} onClose={() => setScanOpen(false)} />
          )}
        </main>

        <aside className="panel">
          <h2 className="step">{t('panel.title')}</h2>
          {simple && !variable2 && main && !error ? (
            <SimplePanel s={main} name={nameOf(main)} loading={loading} onDetailed={() => setSimple(false)} onReport={openReport} />
          ) : variable2 ? (
            <ComparePanel
              a={main}
              b={seriesB}
              varA={variable}
              varB={variable2}
              variables={catalog?.variables ?? []}
              target={target}
              startYear={effectiveStart}
              loading={loading || !seriesB}
              error={error}
              simple={simple}
              territory={main ? nameOf(main) : ''}
              onMethod={() => setMethodOpen(true)}
              onReport={openReport}
              onCsv={() =>
                main &&
                seriesB &&
                download(
                  `compare_${main.variable.id}_${seriesB.variable.id}.csv`,
                  seriesCsv(main, `${nameOf(main)}, ${l(main.variable.name)}`, seriesB, `${nameOf(seriesB)}, ${l(seriesB.variable.name)}`),
                )
              }
            />
          ) : (
            <TrendPanel
              variable={variable}
              variables={catalog?.variables ?? []}
              target={target}
              startYear={effectiveStart}
              main={main}
              other={other}
              loading={loading}
              error={error}
              onCompare={pickCompare}
              onMethod={() => setMethodOpen(true)}
              nameOf={nameOf}
              simple={simple}
              relPreset={relPreset}
              onChain={(c) => {
                setChain(c)
                setFoundPair(null)
                setRule(null)
                setScanOpen(false)
              }}
              onLink={(a, b) => {
                // keep the current variable on the left when it is part of the link
                const [x, y] = variable?.id === b ? [b, a] : [a, b]
                setVariableId(x)
                setRelPreset((p) => ({ id: y, n: (p?.n ?? 0) + 1 }))
              }}
              onReport={openReport}
              onCsv={() => main && download(fileName(main, 'csv'), seriesCsv(main, nameOf(main), other, other ? nameOf(other) : ''))}
            />
          )}
        </aside>
        {methodOpen && <Method series={main} name={main ? nameOf(main) : ''} onClose={() => setMethodOpen(false)} />}
        {tourOpen && <Tour onClose={() => setTourOpen(false)} />}
        {builderOpen && (
          <RuleBuilder
            groups={groups}
            onClose={() => setBuilderOpen(false)}
            onDone={(s) => {
              setSessionRules((rs) => [...rs.filter((x) => x.id !== s.id), s])
              setBuilderOpen(false)
              setScanOpen(false)
              setVariable2Id(null)
              setRule(s.result)
            }}
          />
        )}
      </div>
    </ThemeContext.Provider>
  )
}
