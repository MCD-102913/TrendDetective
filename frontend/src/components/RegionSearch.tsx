import { useEffect, useId, useRef, useState } from 'react'
import { api, type Region } from '../api'
import { useI18n } from '../i18n'

/** Search box for territories: countries, first-level regions and latitude belts (shown when empty). */
export function RegionSearch({ placeholder, onPick }: { placeholder: string; onPick: (r: Region) => void }) {
  const { l } = useI18n()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Region[]>([])
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  // the input keeps the focus; screen readers follow the highlighted option through aria-activedescendant
  const listId = useId()
  const shown = open && results.length > 0

  useEffect(() => {
    if (!open) return
    const ctrl = new AbortController()
    const id = setTimeout(
      () => {
        api
          .regions(text, ctrl.signal)
          .then((r) => {
            setResults(r.results)
            setActive(0)
          })
          .catch(() => {})
      },
      text ? 150 : 0,
    )
    return () => {
      clearTimeout(id)
      ctrl.abort()
    }
  }, [text, open])

  // the list scrolls: keep the option chosen with the arrow keys in view
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const pick = (r: Region) => {
    onPick(r)
    setText('')
    setOpen(false)
  }

  return (
    <div className="search" ref={box}>
      <input
        type="search"
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && results[active] ? `${listId}-${active}` : undefined}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1))
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
          else if (e.key === 'Enter' && results[active]) pick(results[active])
          else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {shown && (
        <ul className="search-results" role="listbox" id={listId} ref={list}>
          {results.map((r, i) => (
            <li
              key={r.region_id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(r)
              }}
            >
              <span>{l(r.name)}</span>
              {r.parent_name && <span className="muted small">{l(r.parent_name)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
