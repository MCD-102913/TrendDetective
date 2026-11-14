// The current view lives in the address bar, so that a link (or the printable report) opens the same thing.
//   v      variable id            r   region id          pt  "lon,lat" (instead of r)
//   c      comparison region id   from start year        view=simple   globe=1
//   v2     second variable: compare mode (two synchronized maps, one territory)
//   layer  normal | last | space (the trend map when absent)
export type ViewState = {
  variable: string | null
  variable2: string | null
  region: string | null
  point: [number, number] | null
  compare: string | null
  from: number | null
  simple: boolean | null
  globe: boolean
  layer?: 'normal' | 'last' | 'space' | null
}

export function readView(search: string = location.search): ViewState {
  const p = new URLSearchParams(search)
  const pt = p.get('pt')?.split(',').map(Number)
  const from = Number(p.get('from'))
  const view = p.get('view')
  return {
    variable: p.get('v'),
    variable2: p.get('v2'),
    region: p.get('r'),
    point: pt && pt.length === 2 && pt.every(Number.isFinite) ? [pt[0], pt[1]] : null,
    compare: p.get('c'),
    from: Number.isInteger(from) && from > 1900 ? from : null,
    simple: view === 'simple' ? true : view === 'detailed' ? false : null,
    globe: p.get('globe') === '1',
    layer: (['normal', 'last', 'space'] as const).find((x) => x === p.get('layer')) ?? null,
  }
}

export function viewQuery(s: ViewState): string {
  const p = new URLSearchParams()
  if (s.variable) p.set('v', s.variable)
  if (s.variable2) p.set('v2', s.variable2)
  if (s.point) p.set('pt', s.point.map((x) => x.toFixed(2)).join(','))
  else if (s.region && s.region !== 'global') p.set('r', s.region)
  if (s.compare) p.set('c', s.compare)
  if (s.from) p.set('from', String(s.from))
  if (s.simple !== null) p.set('view', s.simple ? 'simple' : 'detailed')
  if (s.globe) p.set('globe', '1')
  if (s.layer) p.set('layer', s.layer)
  const lang = new URLSearchParams(location.search).get('lang')
  if (lang) p.set('lang', lang)
  return p.toString()
}

export function writeView(s: ViewState): void {
  const q = viewQuery(s)
  const url = location.pathname + (q ? `?${q}` : '')
  if (url !== location.pathname + location.search) history.replaceState(null, '', url)
}
