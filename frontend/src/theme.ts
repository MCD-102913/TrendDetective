// Visual tokens for charts and the map; CSS variables for the rest live in index.css.
// Palettes checked with the dataviz validator for contrast and colour blind safety.
import { createContext, useContext } from 'react'

export type Theme = 'dark' | 'light'

type Ink = {
  primary: string
  muted: string
  grid: string
  axis: string
  tooltipBg: string
  ocean: string
  land: string
  border: string
  outline: string
  monthly: string
  annual: string
  trend: string
  compare: string
  compareTrend: string
  up: string
  down: string
}

export const INK: Record<Theme, Ink> = {
  dark: {
    primary: '#f0efec',
    muted: '#898781',
    grid: '#2c2c2a',
    axis: '#383835',
    tooltipBg: '#262624',
    ocean: '#0d0d0d',
    land: '#1c1c1b',
    border: 'rgba(240,239,236,0.45)',
    outline: '#f0efec',
    monthly: '#55544f',
    annual: '#3987e5',
    trend: '#f0efec',
    compare: '#d95926',
    compareTrend: '#f0a988',
    up: '#e8807a',
    down: '#6da7ec',
  },
  light: {
    primary: '#0b0b0b',
    muted: '#6f6d68',
    grid: '#e1e0d9',
    axis: '#c3c2b7',
    tooltipBg: '#ffffff',
    ocean: '#dfe6ec',
    land: '#f7f6f3',
    border: 'rgba(11,11,11,0.45)',
    outline: '#0b0b0b',
    monthly: '#c9c7c0',
    annual: '#2a78d6',
    trend: '#0b0b0b',
    compare: '#eb6834',
    compareTrend: '#a8471a',
    up: '#b8312f',
    down: '#1c5cab',
  },
}

export function detectTheme(): Theme {
  const saved = localStorage.getItem('theme')
  if (saved === 'dark' || saved === 'light') return saved
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t
}

export const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({
  theme: 'dark',
  setTheme: () => {},
})
export const useTheme = () => useContext(ThemeContext)
