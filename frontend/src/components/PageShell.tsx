import { type ReactNode, useCallback, useState } from 'react'
import { useI18n } from '../i18n'
import { applyTheme, detectTheme, type Theme, ThemeContext, useTheme } from '../theme'
import { Icon } from './Icon'

export type Page = 'map' | 'forecast' | 'links'

/** Tabs between the three pages; the variable and the territory travel along in the link. */
export function Nav({
  active,
  variable,
  region,
  simple = false,
}: {
  active: Page
  variable?: string | null
  region?: string | null
  simple?: boolean
}) {
  const { t } = useI18n()
  const p = (o: Record<string, string | null | undefined>) => {
    const s = new URLSearchParams()
    Object.entries(o).forEach(([k, v]) => v && s.set(k, v))
    const lang = new URLSearchParams(location.search).get('lang')
    if (lang) s.set('lang', lang)
    const q = s.toString()
    return q ? `?${q}` : ''
  }
  const r = region && region !== 'global' ? region : null
  const links: [Page, string][] = [
    ['map', `/${p({ v: variable, r, view: simple ? 'simple' : 'detailed' })}`],
    ['forecast', `/forecast${p({ v: variable, r, view: simple ? 'simple' : 'detailed' })}`],
    ['links', `/links${p({ vs: variable, r })}`],
  ]
  return (
    <nav className="seg page-nav" aria-label={t('nav.title')}>
      {links.map(([k, href]) => (
        <a key={k} className={`btn ${active === k ? 'on' : ''}`} aria-current={active === k ? 'page' : undefined} href={href}>
          {t(`nav.${k}`)}
        </a>
      ))}
    </nav>
  )
}

/** Theme for a standalone page; it wraps the page component so that its charts read the same theme. */
export function ThemeRoot({ children }: { children: ReactNode }) {
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
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

/** A standalone page: the top bar with the tabs, language and theme, then the page itself (inside ThemeRoot). */
export function PageShell({
  active,
  variable,
  region,
  simple,
  onSimple,
  children,
}: {
  active: Page
  variable?: string | null
  region?: string | null
  children: ReactNode
  /** pages with a simple view (forecasts): the switch in the top bar */
  simple?: boolean
  onSimple?: (v: boolean) => void
}) {
  const { t, lang, setLang } = useI18n()
  const { theme, setTheme } = useTheme()
  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <h1>
            <a href="/">{t('app.title')}</a>
          </h1>
          <span className="muted tagline">{t(`nav.${active}Tagline`)}</span>
        </div>
        <div className="topbar-right">
          <Nav active={active} variable={variable} region={region} simple={!!simple} />
          {onSimple && (
            <div className="seg" role="group" aria-label={t('view.title')}>
              <button className={`btn ${simple ? 'on' : ''}`} aria-pressed={!!simple} onClick={() => onSimple(true)}>
                {t('view.simple')}
              </button>
              <button className={`btn ${!simple ? 'on' : ''}`} aria-pressed={!simple} onClick={() => onSimple(false)}>
                {t('view.detailed')}
              </button>
            </div>
          )}
          <button className="btn" onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')} aria-label="Language">
            {lang === 'ru' ? 'EN' : 'RU'}
          </button>
          <button
            className="btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={t('theme.toggle')}
            title={t('theme.toggle')}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
          </button>
        </div>
      </header>
      <main className="page-body">{children}</main>
    </div>
  )
}
