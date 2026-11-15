import { useState } from 'react'
import { useI18n } from '../i18n'
import { Icon } from './Icon'

// how long the button says "copied"
const DONE_MS = 2000

/** Copies the address of the current view: the link opens the same variable, territory and mode. */
export function CopyLink() {
  const { t } = useI18n()
  const [done, setDone] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location.href)
    } catch {
      // no clipboard permission (an old browser or a plain http page): fall back to a hidden text field
      const field = document.createElement('textarea')
      field.value = location.href
      document.body.appendChild(field)
      field.select()
      document.execCommand('copy')
      field.remove()
    }
    setDone(true)
    setTimeout(() => setDone(false), DONE_MS)
  }

  return (
    <button type="button" className="btn" onClick={copy} title={t('link.hint')} aria-live="polite">
      <Icon name={done ? 'check' : 'link'} /> {done ? t('link.copied') : t('link.copy')}
    </button>
  )
}
