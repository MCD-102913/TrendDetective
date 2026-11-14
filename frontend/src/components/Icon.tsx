// Line icons drawn in the current text colour, so they follow the theme and the state of the parent.
import type { ReactNode } from 'react'

const SUN_RAYS = 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'

const SHAPES = {
  thermometer: (
    <>
      <path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z" />
      <path d="M12 9v7.5" />
      <circle cx="12" cy="17.5" r="1.2" fill="currentColor" />
    </>
  ),
  leaf: (
    <>
      <path d="M5 19c0-8.5 5.5-14 15-14 0 9.5-5.5 14-15 14z" />
      <path d="M5 19l8-8" />
    </>
  ),
  snowflake: (
    <>
      <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
      <path d="M9.5 4.5L12 6l2.5-1.5M9.5 19.5L12 18l2.5 1.5" />
    </>
  ),
  factory: (
    <>
      <path d="M3 20V11l5 3v-3l5 3v-3l5 3V4h3v16z" />
      <path d="M7 17h2M12 17h2" />
    </>
  ),
  drought: (
    <>
      <circle cx="12" cy="8" r="3" />
      <path d="M12 2.5v1M6.5 8h-1M18.5 8h-1M8.1 4.1l.7.7M15.9 4.1l-.7.7" />
      <path d="M3 15h18" />
      <path d="M9 15l1.5 2.5-1 3M15 15l-1 2 1.5 3.5" />
    </>
  ),
  rain: (
    <>
      <path d="M7 14h10a3.5 3.5 0 0 0 .4-7A5.5 5.5 0 0 0 6.6 8.2 3 3 0 0 0 7 14z" />
      <path d="M8.5 17l-1 3M12.5 17l-1 3M16.5 17l-1 3" />
    </>
  ),
  waves: <path d="M3 8c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 13c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />,
  iceberg: (
    <>
      <path d="M2 14h20" />
      <path d="M6.5 14L10 6l2 2.5L14 5l3.5 9" />
      <path d="M7.5 14l2.5 6h4l2.5-6" opacity="0.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d={SUN_RAYS} />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  cross: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  open: <circle cx="12" cy="12" r="5.5" />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof SHAPES

/** Decorative by default; pass `label` when the icon is the only thing that carries the meaning. */
export function Icon({
  name,
  size = '1em',
  label,
  className,
}: {
  name: IconName
  size?: number | string
  label?: string
  className?: string
}) {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {SHAPES[name]}
    </svg>
  )
}

/** The mark of a passed or failed check, used in tables and lists. */
export const Mark = ({ ok, fail = 'cross' }: { ok: boolean; fail?: 'cross' | 'open' }) => (
  <Icon name={ok ? 'check' : fail} className={ok ? 'mark-ok' : 'mark-fail'} />
)
