// Line icons from Lucide (lucide.dev, ISC license) drawn in the current text colour, so they follow the theme and
// the state of the parent.
import {
  Check,
  Circle,
  CloudRain,
  DropletOff,
  Factory,
  Leaf,
  type LucideIcon,
  Moon,
  MountainSnow,
  Snowflake,
  Sparkles,
  Sun,
  Thermometer,
  ThermometerSnowflake,
  Waves,
  X,
} from 'lucide-react'

const SHAPES = {
  thermometer: Thermometer,
  leaf: Leaf,
  snowflake: Snowflake,
  factory: Factory,
  drought: DropletOff,
  rain: CloudRain,
  waves: Waves,
  iceberg: MountainSnow,
  altitude: ThermometerSnowflake,
  sun: Sun,
  moon: Moon,
  check: Check,
  cross: X,
  open: Circle,
  spark: Sparkles,
} satisfies Record<string, LucideIcon>

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
  const Shape = SHAPES[name]
  return (
    <Shape
      className={`icon ${className ?? ''}`}
      size={size}
      strokeWidth={1.8}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}

/** The mark of a passed or failed check, used in tables and lists. */
export const Mark = ({ ok, fail = 'cross' }: { ok: boolean; fail?: 'cross' | 'open' }) => (
  <Icon name={ok ? 'check' : fail} className={ok ? 'mark-ok' : 'mark-fail'} />
)
