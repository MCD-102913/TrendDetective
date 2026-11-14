import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { type Key, useI18n } from '../i18n'

// Each step points at a part of the interface (CSS selector); a missing element puts the card in the centre.
const STEPS: { sel: string; key: string }[] = [
  { sel: '.picker', key: '1' },
  { sel: '.legend', key: '2' },
  { sel: '.map-tools', key: '3' },
  { sel: '.verdicts', key: '4' },
  { sel: '.chart-wrap', key: '5' },
  { sel: '.panel-actions', key: '6' },
  { sel: '.relation', key: '7' },
  { sel: '.view-tools', key: '8' },
]
const CARD_W = 340
const PAD = 8

export const TOUR_DONE_KEY = 'tourDone_v1'

/** "How to read": a step-by-step spotlight over the interface. Shown once on the first visit, then from the top bar. */
export function Tour({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const step = STEPS[i]

  const measure = useCallback(() => {
    const el = document.querySelector(step.sel) as HTMLElement | null
    setRect(el && el.offsetParent !== null ? el.getBoundingClientRect() : null)
  }, [step.sel])

  useLayoutEffect(() => {
    const el = document.querySelector(step.sel) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest', behavior: 'instant' as ScrollBehavior })
    measure()
  }, [step.sel, measure])

  useEffect(() => {
    const on = () => measure()
    window.addEventListener('resize', on)
    window.addEventListener('scroll', on, true)
    const id = setInterval(on, 400) // the panel content loads asynchronously
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('scroll', on, true)
      clearInterval(id)
    }
  }, [measure])

  const close = useCallback(() => {
    try {
      localStorage.setItem(TOUR_DONE_KEY, '1')
    } catch {
      /* storage blocked */
    }
    onClose()
  }, [onClose])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') setI((v) => Math.min(v + 1, STEPS.length - 1))
      else if (e.key === 'ArrowLeft') setI((v) => Math.max(v - 1, 0))
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [close])

  // the card goes beside the highlighted element: right, left, below, above, or centred
  let card: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
  if (rect) {
    const vw = innerWidth
    const vh = innerHeight
    const top = Math.min(Math.max(rect.top, 12), vh - 260)
    if (rect.right + CARD_W + 24 < vw) card = { left: rect.right + 16, top }
    else if (rect.left - CARD_W - 24 > 0) card = { left: rect.left - CARD_W - 16, top }
    else if (rect.bottom + 230 < vh) card = { left: Math.min(Math.max(rect.left, 12), vw - CARD_W - 12), top: rect.bottom + 12 }
    else card = { left: Math.min(Math.max(rect.left, 12), vw - CARD_W - 12), top: Math.max(rect.top - 240, 12) }
  }
  const last = i === STEPS.length - 1
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={t('tour.open')}>
      {rect ? (
        <>
          {/* four dark panes around the highlighted element */}
          <div className="tour-dim" style={{ left: 0, top: 0, right: 0, height: Math.max(rect.top - PAD, 0) }} />
          <div className="tour-dim" style={{ left: 0, top: rect.bottom + PAD, right: 0, bottom: 0 }} />
          <div
            className="tour-dim"
            style={{ left: 0, top: rect.top - PAD, width: Math.max(rect.left - PAD, 0), height: rect.height + 2 * PAD }}
          />
          <div className="tour-dim" style={{ left: rect.right + PAD, top: rect.top - PAD, right: 0, height: rect.height + 2 * PAD }} />
          <div
            className="tour-spot"
            style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + 2 * PAD, height: rect.height + 2 * PAD }}
          />
        </>
      ) : (
        <div className="tour-dim" style={{ inset: 0 }} />
      )}
      <div className="tour-card" style={{ ...card, width: CARD_W }}>
        <div className="muted small">{t('tour.step', { i: i + 1, n: STEPS.length })}</div>
        <h3>{t(`tour.${step.key}.title` as Key)}</h3>
        <p>{t(`tour.${step.key}.text` as Key)}</p>
        <div className="tour-actions">
          <button type="button" className="btn" onClick={close}>
            {t('tour.skip')}
          </button>
          <span className="tour-spacer" />
          {i > 0 && (
            <button type="button" className="btn" onClick={() => setI(i - 1)}>
              {t('tour.prev')}
            </button>
          )}
          <button type="button" className="btn primary" onClick={() => (last ? close() : setI(i + 1))} autoFocus>
            {last ? t('tour.done') : t('tour.next')}
          </button>
        </div>
      </div>
    </div>
  )
}
