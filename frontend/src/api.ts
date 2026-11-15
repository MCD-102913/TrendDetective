// API client and response types of the backend
export type L10n = { en: string; ru: string }

export type Variable = {
  id: string
  name: L10n
  hint: L10n
  sphere: string
  source: string
  units: string
  kind: 'abs' | 'rel'
  decimals: number
  start: string
  end: string
  resolution: [number, number]
  palette: string
  /** set for pressure level variables: the quantity and its level, for the trend-by-height chart */
  profile?: { quantity: string; level: number; height_km: number } | null
}

export type Catalog = {
  spheres: Record<string, L10n>
  sources: Record<string, L10n & { type: 'model' | 'satellite' }>
  variables: Variable[]
  profiles?: Record<string, L10n>
}

export type Region = {
  region_id: string
  level: number
  name: L10n
  parent_name: L10n | null
  bbox: [number, number, number, number]
}

export type Verdict = 'significant_up' | 'significant_down' | 'likely_up' | 'likely_down' | 'no_trend' | 'too_short'

export type Rate = { per_decade: number; lo: number; hi: number; intercept?: number }

export type Series = {
  variable: { id: string; name: L10n; units: string; kind: 'abs' | 'rel'; decimals: number; source: string }
  territory: {
    region_id: string | null
    name: L10n
    parent_name: L10n | null
    bbox: number[]
    kind: 'region' | 'area' | 'point'
    cells: number
    cells_with_data: number
    cell?: [number, number]
    terrain?: { id: string; name: L10n }
  }
  period: { start: string; end: string }
  time: string[]
  value: (number | null)[]
  anomaly: (number | null)[]
  climatology: (number | null)[]
  annual: { years: number[]; value: (number | null)[]; anomaly: (number | null)[] }
  mean: number
  n_months: number
  n_years: number
  verdict: Verdict
  rate?: Rate
  rate_rel?: Rate
  sen?: Rate
  tests?: {
    t_test: { p: number; n_eff: number; r1: number }
    mann_kendall: { p: number; z: number; tau: number }
    sen_interval: { excludes_zero: boolean }
  }
  total_change?: number
  change_point?: { year: number; p: number; before: number; after: number; shift: number; is_step: boolean } | null
  years_to_detect?: number | null
  noise_sd?: number
  robustness?: {
    robust: boolean
    checks: { halves: boolean; drop_start: boolean; drop_end: boolean; no_step: boolean } | null
    first_half?: number
    second_half?: number
    split_year?: number
  }
  second_opinion: {
    id: string
    name: L10n
    source: string
    years: [number, number]
    verdict: Verdict
    units: string
    decimals: number
    per_decade: number
    agrees: boolean
  }[]
  outlook?: Outlook
}

/** A link found by the exhaustive search on one territory (tools/discover.py); positive lag: a leads b. */
export type FoundKind = 'independent' | 'same_instrument' | 'forcing' | 'same_model'
export type FoundLink = {
  a: string
  b: string
  a_name: L10n
  b_name: L10n
  kind: FoundKind
  r: number
  lag: number
  p: number
  r_first: number
  lag_first: number
  r_second: number
  lag_second: number | null
  split: number
  years: [number, number]
}
export type FoundCounts = {
  pairs: number
  territories: number
  tests: number
  found: number
  found_null: number
  expected_false_share: number | null
  admin1?: number
  chains_tested?: number
  chains_found?: number
}
/** A chain A -> B -> C found on one territory: lags of the two links, r of A with C and what is left with B taken into account. */
export type ChainKey = { a: string; b: string; c: string }
export type FoundChain = ChainKey & {
  a_name: L10n
  b_name: L10n
  c_name: L10n
  lag1: number
  lag2: number
  r_ab: number
  r_bc: number
  r_ac: number
  partial: number
  kind: FoundKind
}
export type ChainSummary = ChainKey & {
  a_name: L10n
  b_name: L10n
  c_name: L10n
  kind: FoundKind
  tested: number
  found: number
  countries: number
  median_r_ac: number
  median_partial: number
  lag1: number
  lag2: number
}
export type ChainDetail = ChainSummary & { counts: FoundCounts; regions: (FoundChain & Region)[] }
export type FoundPair = {
  a: string
  b: string
  a_name: L10n
  b_name: L10n
  kind: FoundKind
  tested: number
  found: number
  positive: number
  negative: number
  median_r: number | null
  median_lag: number | null
}
export type FoundPairDetail = FoundPair & { counts: FoundCounts; regions: (FoundLink & Region)[] }
export type Discoveries = { generated: string; counts: FoundCounts; pairs: FoundPair[] }

/** The outlook of every country for one variable (the forecast page and its map). */
export type ForecastRow = {
  region_id: string
  name: L10n
  bbox: number[]
  available: boolean
  reason?: string
  scope?: string
  model?: string
  verdict: string
  mean: number
  year_end?: number
  last_year?: number
  ref?: number
  change?: number
  mid_end?: number
  lo95_end?: number
  hi95_end?: number
  per_decade?: number
}
export type ForecastMap = {
  variable: string
  generated: string
  units: string
  decimals: number
  scale: number
  colors: string[]
  bounds: [number, number, number, number]
  rows: ForecastRow[]
}
/** Every pair of the chosen variables on one territory (the links page). */
export type MatrixPair = {
  a: string
  b: string
  verdict: RelationVerdict
  raw?: { r: number; p: number }
  detrended?: { r: number; p: number }
  best?: { lag: number; r: number; p: number }
  explained?: number
  n_months?: number
  n_eff?: number
  lags?: { lag: number; r: number }[]
  period?: [string, string]
  points?: { x: number[]; y: number[] }
}
export type RelationMatrix = {
  territory: { name: L10n }
  variables: { id: string; name: L10n; units: string; decimals: number }[]
  pairs: MatrixPair[]
  annual: Record<string, { years: number[]; value: (number | null)[] }>
  found: { links: { a: string; b: string; r: number; lag: number }[]; chains: FoundChain[] }
}

/** Hindcast summary of a variable: how the "if the trend continues" rule did on the past. */
export type OutlookModel = 'line' | 'anchored' | 'damped' | 'mean'
export type HindcastSummary = {
  cases: number
  skill?: number
  coverage80?: number
  coverage95?: number
  enabled: boolean
  model?: OutlookModel
  scope?: string
  scope_name?: L10n
}
/** Annual anomalies continued along the trend line (values are differences from the record mean). */
export type Outlook =
  | { available: false; reason: 'no_hindcast' | 'no_skill' | 'not_significant' | 'not_robust' | 'too_short'; hindcast?: HindcastSummary }
  | {
      available: true
      hindcast: HindcastSummary
      years: number[]
      mid: number[]
      lo80: number[]
      hi80: number[]
      lo95: number[]
      hi95: number[]
      last_year: number
      ref: number
      per_decade: number
    }
export type ForecastSkill = {
  generated: string
  rule: {
    train_fractions: number[]
    horizon_fraction: number
    min_cases: number
    min_coverage95: number
    models: OutlookModel[]
    zones: Record<string, L10n>
  }
  variables: { id: string; name: L10n; world: HindcastSummary; zones: Record<string, HindcastSummary> }[]
}

export type RelationVerdict = 'linked_positive' | 'linked_negative' | 'common_trend_only' | 'no_link' | 'too_short'
export type Relation = {
  x: { id: string; name: L10n; units: string }
  y: { id: string; name: L10n; units: string }
  period: { start: string; end: string }
  n_months: number
  n_eff: number
  raw: { r: number; p: number }
  detrended: { r: number; p: number }
  best?: { lag: number; r: number; p: number }
  explained?: number
  verdict: RelationVerdict
  annual?: { years: number[]; x: (number | null)[]; y: (number | null)[] }
}

export type RuleLink = { from: string; to: string; sign: '+' | '-'; max_lag: number; from_name: L10n; to_name: L10n }
export type RuleCard = {
  id: string
  name: L10n
  description: L10n | null
  author?: string | null
  source?: string | null
  links: RuleLink[]
}
export type RuleStatus = 'confirmed' | 'partial' | 'contradicted' | 'not_confirmed' | 'no_data'
export type RuleResult = RuleCard & {
  fdr_p: number
  n_tests: number
  counts: Record<RuleStatus, number>
  territories: (Region & {
    status: RuleStatus
    links: {
      status: 'proven' | 'contradicted' | 'not_proven' | 'no_data'
      r?: number
      p?: number
      lag?: number
      trends_agree?: boolean | null
    }[]
  })[]
}

export type Verification = {
  tool: 'giovanni' | 'power'
  tool_name?: string
  variable: string
  place?: L10n | string
  error?: string
  verdict: 'match' | 'consistent' | 'differs' | 'too_short'
  n_months: number
  period?: [string, string]
  r: number
  r_anomaly: number
  bias: number
  rel_bias: number | null
  rmse: number
  box: [number, number, number, number] | null
  point: [number, number] | null
  trend_ours?: { per_decade: number; verdict: Verdict }
  trend_ref?: { per_decade: number; verdict: Verdict }
  trend_agrees?: boolean
  series?: { months: string[]; ours: number[]; ref: number[] }
}
export type VerifyTools = {
  tools: Record<string, { name: string; geometry: string; about: L10n }>
  variables: Record<string, string[]>
  names: Record<string, L10n>
}

export type ScanRow = Region & { per_decade: number; lo: number; hi: number; strength: number }
export type Scan = {
  variable: string
  units: string
  decimals: number
  n_robust: number
  n_up: number
  n_down: number
  up: ScanRow[]
  down: ScanRow[]
}

/** What the map shows: the trend, the climate normal, the last complete year against it, or NASA imagery. */
export type MapLayer = 'trend' | 'normal' | 'last' | 'space'
export type MapMeta = {
  variable: string
  layer: 'trend' | 'normal' | 'last'
  years: [number, number]
  scale: number
  units: string
  colors: string[]
  fdr_p: number
  share_sig_up: number
  share_sig_down: number
  share_up: number
  bounds: [number, number, number, number]
  lo?: number // normal: colour range (log10 when log)
  hi?: number
  log?: boolean
  year?: number // last: the year shown
  share_above?: number
}
/** The latest NASA GIBS imagery closest to a variable. */
export type SpaceLayer = {
  layer: string
  title: string
  date: string
  true_color: boolean
  tiles: string
  maxzoom: number
  legend: string | null
  worldview: string
}

/** A territory; `terrain` narrows a region to the cells of one terrain type (forests, croplands...). */
export type Target = { kind: 'region'; region: Region; terrain?: string | null } | { kind: 'point'; point: [number, number] }

export type Profile = {
  quantity: string
  name: L10n
  units: string
  decimals: number
  source: string
  levels: {
    variable: string
    level: number
    height_km: number
    verdict: Verdict | 'no_data'
    rate?: Rate
    mean?: number
    years?: [number, number]
  }[]
}

export type TerrainTypes = { year: number | null; types: { id: string; name: L10n; cells: number }[] }

export const where = (target: Target) =>
  target.kind === 'region' ? { region_id: target.region.region_id, terrain: target.terrain ?? undefined } : { point: target.point }

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      detail = (await res.json()).detail ?? detail
    } catch {
      /* not JSON */
    }
    throw new Error(detail)
  }
  return res.json()
}

const q = (params: Record<string, string | number | boolean | undefined | null>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')

export const api = {
  catalog: () => fetch('/api/variables').then(json<Catalog>),
  regions: (text: string, signal?: AbortSignal) => fetch(`/api/regions?${q({ q: text })}`, { signal }).then(json<{ results: Region[] }>),
  home: () => fetch('/api/home').then(json<{ region_id: string | null }>),
  region: (id: string) => fetch(`/api/regions/${id}`).then(json<Region>),
  geometry: (id: string) => fetch(`/api/regions/${id}/geometry`).then(json<GeoJSON.Geometry>),
  terrain: (regionId: string | null) => fetch(`/api/terrain?${q({ region_id: regionId })}`).then(json<TerrainTypes>),
  series: (variable: string, target: Target, startYear: number | null, signal?: AbortSignal) =>
    fetch('/api/series', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        variable,
        start_year: startYear,
        ...where(target),
      }),
    }).then(json<Series>),
  relation: (variable: string, other: string, target: Target, startYear: number | null, signal?: AbortSignal) =>
    fetch('/api/relation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        variable,
        other,
        start_year: startYear,
        ...where(target),
      }),
    }).then(json<Relation>),
  profile: (quantity: string, target: Target, startYear: number | null, signal?: AbortSignal) =>
    fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ quantity, start_year: startYear, ...where(target) }),
    }).then(json<Profile>),
  scan: (variable: string, startYear: number | null, signal?: AbortSignal) =>
    fetch(`/api/scan?${q({ variable, start_year: startYear })}`, { signal }).then(json<Scan>),
  rules: () => fetch('/api/rules').then(json<{ version: string; rules: RuleCard[] }>),
  rule: (id: string, signal?: AbortSignal) => fetch(`/api/rules/${id}`, { signal }).then(json<RuleResult>),
  /** A session rule: validated and evaluated by the server, never saved there. Errors come back as a list. */
  tryRule: async (yaml: string, signal?: AbortSignal): Promise<RuleResult | { errors: string[] }> => {
    const r = await fetch('/api/rules/try', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml }),
      signal,
    })
    if (r.status === 422) return { errors: (await r.json()).errors ?? ['invalid rule'] }
    return json<RuleResult>(r)
  },
  found: (limit = 60) => fetch(`/api/discoveries?limit=${limit}`).then(json<Discoveries>),
  foundRegion: (id: string) =>
    fetch(`/api/discoveries/region/${id}`).then(
      json<{
        links: FoundLink[]
        counts: FoundCounts
        total: number
        chains?: FoundChain[]
        chains_total?: number
      }>,
    ),
  chains: (limit = 40) => fetch(`/api/chains?limit=${limit}`).then(json<{ counts: FoundCounts; chains: ChainSummary[] }>),
  chain: (a: string, b: string, c: string) => fetch(`/api/chains/${a}/${b}/${c}`).then(json<ChainDetail>),
  foundPair: (a: string, b: string) => fetch(`/api/discoveries/pair/${a}/${b}`).then(json<FoundPairDetail>),
  forecastMap: (variable: string) => fetch(`/api/forecast/map?${q({ variable })}`).then(json<ForecastMap>),
  forecastWhere: (variable: string, lat: number, lon: number) =>
    fetch(`/api/forecast/where?${q({ variable, lat, lon })}`).then(json<Region>),
  matrix: (variables: string[], target: Target, signal?: AbortSignal) =>
    fetch('/api/relations/matrix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        variable: variables[0],
        variables,
        ...where(target),
      }),
    }).then(json<RelationMatrix>),
  forecastSkill: () => fetch('/api/forecast/skill').then(json<ForecastSkill>),
  verifyTools: () => fetch('/api/verify/tools').then(json<VerifyTools>),
  verifyReference: () => fetch('/api/verify/reference').then(json<{ generated?: string; cases: Verification[] }>),
  verify: (variable: string, regionId: string | null, point: [number, number] | null, tool?: string) =>
    fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variable, tool, ...(point ? { point } : { region_id: regionId }) }),
    }).then(json<Verification>),
  mapMeta: (variable: string, startYear: number | null, signal?: AbortSignal, layer: MapMeta['layer'] = 'trend') =>
    fetch(`/api/map/meta?${q({ variable, start_year: startYear, layer: layer === 'trend' ? undefined : layer })}`, { signal }).then(
      json<MapMeta>,
    ),
  mapUrl: (variable: string, startYear: number | null, sigOnly: boolean, layer: MapMeta['layer'] = 'trend') =>
    layer === 'trend'
      ? `/api/map.png?${q({ variable, start_year: startYear, sig_only: sigOnly })}`
      : `/api/map.png?${q({ variable, layer })}`,
  space: (variable: string, signal?: AbortSignal) => fetch(`/api/space?${q({ variable })}`, { signal }).then(json<SpaceLayer>),
}
