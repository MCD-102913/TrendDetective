import { useEffect, useMemo, useState } from 'react'
import { api, type L10n, type Region, type RuleResult, type Variable } from '../api'
import { useI18n } from '../i18n'
import { RegionSearch } from './RegionSearch'

export type SessionRule = { id: string; yaml: string; result: RuleResult }

type Link = { from: string; to: string; sign: '+' | '-'; lag: number }
type Group = { id: string; name: L10n; items: Variable[] }
type Props = { groups: Group[]; onDone: (r: SessionRule) => void; onClose: () => void }

const MAX_LINKS = 6
const q = (s: string) => JSON.stringify(s) // a JSON string is a valid double-quoted YAML string

/** Builds a YAML document with one rule from the form. The server validates it like any rules file. */
function toYaml(id: string, name: string, desc: string, links: Link[], terr: 'countries' | 'oceans' | 'list', list: Region[]): string {
  const lines = ['version: 1', 'rules:', `  - id: ${id}`, '    name:', `      en: ${q(name)}`, `      ru: ${q(name)}`]
  if (desc.trim()) lines.push('    description:', `      en: ${q(desc.trim())}`, `      ru: ${q(desc.trim())}`)
  lines.push('    links:')
  for (const k of links) lines.push(`      - {from: ${k.from}, to: ${k.to}, sign: "${k.sign}", max_lag: ${k.lag}}`)
  lines.push(`    territories: ${terr === 'list' ? `[${list.map((r) => r.region_id).join(', ')}]` : terr}`)
  return lines.join('\n') + '\n'
}

/** "My hypothesis": a form (or YAML) for a rule that is checked on the data and kept only in this browser tab. */
export function RuleBuilder({ groups, onDone, onClose }: Props) {
  const { t, l } = useI18n()
  const first = groups[0]?.items[0]?.id ?? 't2m'
  const [id] = useState(() => `my_${Date.now().toString(36)}`)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [links, setLinks] = useState<Link[]>([{ from: 'precip_gpm', to: 'soil_root', sign: '+', lag: 2 }])
  const [terr, setTerr] = useState<'countries' | 'oceans' | 'list'>('countries')
  const [list, setList] = useState<Region[]>([])
  const [tab, setTab] = useState<'form' | 'yaml'>('form')
  const [yamlText, setYamlText] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  const generated = useMemo(() => toYaml(id, name || t('rb.untitled'), desc, links, terr, list), [id, name, desc, links, terr, list, t])
  const setLink = (i: number, patch: Partial<Link>) => setLinks((ls) => ls.map((k, j) => (j === i ? { ...k, ...patch } : k)))
  const addLink = () => setLinks((ls) => [...ls, { from: ls[ls.length - 1]?.to ?? first, to: first, sign: '+', lag: 1 }])

  const submit = async () => {
    const text = tab === 'form' ? generated : yamlText
    if (tab === 'form' && !name.trim()) {
      setErrors([t('rb.needName')])
      return
    }
    if (tab === 'form' && terr === 'list' && list.length === 0) {
      setErrors([t('rb.needTerritory')])
      return
    }
    setBusy(true)
    setErrors([])
    try {
      const r = await api.tryRule(text)
      if ('errors' in r) setErrors(r.errors)
      else onDone({ id: r.id, yaml: text, result: r })
    } catch (e) {
      setErrors([String((e as Error).message ?? e)])
    } finally {
      setBusy(false)
    }
  }

  const select = (value: string, onChange: (v: string) => void, label: string) => (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {groups.map((g) => (
        <optgroup key={g.id} label={l(g.name)}>
          {g.items.map((v) => (
            <option key={v.id} value={v.id}>
              {l(v.name)} · {v.source}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal rb" role="dialog" aria-modal="true" aria-label={t('rb.title')}>
        <header className="modal-head">
          <h2>{t('rb.title')}</h2>
          <button className="btn" onClick={onClose}>
            {t('method.close')}
          </button>
        </header>
        <div className="modal-body">
          <p className="muted small">{t('rb.intro')}</p>
          <div className="seg" role="tablist">
            <button
              className={`btn ${tab === 'form' ? 'on' : ''}`}
              role="tab"
              aria-selected={tab === 'form'}
              onClick={() => setTab('form')}
            >
              {t('rb.tabForm')}
            </button>
            <button
              className={`btn ${tab === 'yaml' ? 'on' : ''}`}
              role="tab"
              aria-selected={tab === 'yaml'}
              onClick={() => {
                if (tab !== 'yaml') setYamlText(generated)
                setTab('yaml')
              }}
            >
              {t('rb.tabYaml')}
            </button>
          </div>

          {tab === 'form' ? (
            <>
              <label className="rb-field">
                <span>{t('rb.name')}</span>
                <input
                  className="rb-input"
                  value={name}
                  maxLength={120}
                  placeholder={t('rb.namePh')}
                  onChange={(e) => setName(e.target.value.replace(/[<>{}]/g, ''))}
                />
              </label>
              <label className="rb-field">
                <span>{t('rb.desc')}</span>
                <input
                  className="rb-input"
                  value={desc}
                  maxLength={600}
                  placeholder={t('rb.descPh')}
                  onChange={(e) => setDesc(e.target.value.replace(/[<>{}]/g, ''))}
                />
              </label>

              <div className="rb-field">
                <span>{t('rb.links')}</span>
                <ol className="rb-links">
                  {links.map((k, i) => (
                    <li key={i} className="rb-link">
                      {select(k.from, (v) => setLink(i, { from: v }), t('rb.from'))}
                      <select
                        className="select rb-sign"
                        value={k.sign}
                        onChange={(e) => setLink(i, { sign: e.target.value as '+' | '-' })}
                        aria-label={t('rb.sign')}
                      >
                        <option value="+">{t('rb.plus')}</option>
                        <option value="-">{t('rb.minus')}</option>
                      </select>
                      {select(k.to, (v) => setLink(i, { to: v }), t('rb.to'))}
                      <label className="rb-lag">
                        <span className="muted small">{t('rb.lag')}</span>
                        <select className="select" value={k.lag} onChange={(e) => setLink(i, { lag: Number(e.target.value) })}>
                          {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                            <option key={n} value={n}>
                              {t('rb.months', { n })}
                            </option>
                          ))}
                        </select>
                      </label>
                      {links.length > 1 && (
                        <button
                          className="btn"
                          onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}
                          aria-label={t('compare.remove')}
                        >
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
                {links.length < MAX_LINKS && (
                  <button className="btn" onClick={addLink}>
                    {t('rb.addLink')}
                  </button>
                )}
                <p className="muted small">{t('rb.signHint')}</p>
              </div>

              <div className="rb-field">
                <span>{t('rb.where')}</span>
                <div className="rb-terr">
                  {(['countries', 'oceans', 'list'] as const).map((m) => (
                    <label key={m} className="check">
                      <input type="radio" name="terr" checked={terr === m} onChange={() => setTerr(m)} />
                      <span>{t(`rb.terr.${m}`)}</span>
                    </label>
                  ))}
                </div>
                {terr === 'list' && (
                  <>
                    <RegionSearch
                      placeholder={t('rb.addTerritory')}
                      onPick={(r) => setList((ls) => (ls.some((x) => x.region_id === r.region_id) || ls.length >= 300 ? ls : [...ls, r]))}
                    />
                    <div className="rb-chips">
                      {list.map((r) => (
                        <span key={r.region_id} className="rb-chip">
                          {l(r.name)}
                          <button
                            onClick={() => setList((ls) => ls.filter((x) => x.region_id !== r.region_id))}
                            aria-label={t('compare.remove')}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <details className="rb-preview">
                <summary className="muted small">{t('rb.preview')}</summary>
                <pre>{generated}</pre>
              </details>
            </>
          ) : (
            <div className="rb-field">
              <span className="muted small">{t('rb.yamlHint')}</span>
              <textarea className="rb-yaml" value={yamlText} onChange={(e) => setYamlText(e.target.value)} spellCheck={false} rows={16} />
            </div>
          )}

          {errors.length > 0 && (
            <ul className="rules-errors">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <div className="rules-actions">
            <button className="btn primary" onClick={submit} disabled={busy}>
              {busy ? t('rb.checking') : t('rb.check')}
            </button>
            <span className="muted small">{t('rb.session')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
