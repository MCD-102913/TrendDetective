import { type ComponentType, type LazyExoticComponent, lazy, type ReactNode, Suspense } from 'react'
import App from './App.tsx'
import { ThemeRoot } from './components/PageShell'

const Report = lazy(() => import('./components/Report').then((m) => ({ default: m.Report })))
const CompareReport = lazy(() => import('./components/CompareReport').then((m) => ({ default: m.CompareReport })))
const ForecastPage = lazy(() => import('./components/ForecastPage').then((m) => ({ default: m.ForecastPage })))
const LinksPage = lazy(() => import('./components/LinksPage').then((m) => ({ default: m.LinksPage })))

/** A deployment may add pages and a gate that replaces the whole site, for example when a login is revoked. */
export type Extension = {
  routes?: Record<string, LazyExoticComponent<ComponentType>>
  useGate?: () => ReactNode | null
}

// optional modules in src/extensions/<name>/index.tsx; the site works the same without any
const EXTENSIONS = Object.values(import.meta.glob<Extension>('./extensions/*/index.tsx', { eager: true, import: 'extension' }))
const ROUTES = Object.assign({}, ...EXTENSIONS.map((e) => e.routes ?? {})) as Record<string, LazyExoticComponent<ComponentType>>
// the list is fixed at build time, so the hooks run in the same order on every render
const GATES = EXTENSIONS.flatMap((e) => (e.useGate ? [e.useGate] : []))

/** Routes the pages; the map is the default one. */
export function Root() {
  const gates = GATES.map((use) => use())
  const blocked = gates.find((g) => g)
  if (blocked) return blocked
  const path = location.pathname.replace(/\/$/, '')
  if (path === '/report')
    return <Suspense fallback={null}>{new URLSearchParams(location.search).get('v2') ? <CompareReport /> : <Report />}</Suspense>
  if (path === '/forecast' || path === '/links')
    return (
      <ThemeRoot>
        <Suspense fallback={null}>{path === '/forecast' ? <ForecastPage /> : <LinksPage />}</Suspense>
      </ThemeRoot>
    )
  const Page = ROUTES[path]
  if (Page)
    return (
      <Suspense fallback={null}>
        <Page />
      </Suspense>
    )
  return <App />
}
