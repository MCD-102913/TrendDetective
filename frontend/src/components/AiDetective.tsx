import { useEffect, useState } from 'react'
import { type Target, type Variable, where } from '../api'
import { useI18n } from '../i18n'
import { Icon, Mark } from './Icon'

type Goal = 'what_changes' | 'why' | 'link' | 'outlook' | 'custom'
type Evidence = Record<string, unknown> & {
  verdict?: string
  per_decade?: number | null
  units?: string
  r?: number | null
  lag_months?: number | null
  levels?: { hpa: number; verdict: string }[]
}
type Finding = { kind: 'trend' | 'link' | 'profile'; variable: string; other: string | null; note: string; evidence: Evidence }
type Answer = { headline: string; answer: string; findings: Finding[]; next: string[]; model: string; cached: boolean }

const MAX_TEXT = 200
const GOALS: Goal[] = ['what_changes', 'why', 'link', 'outlook', 'custom']

const T = {
  en: {
    open: 'Ask the AI detective',
    title: 'AI detective',
    intro: 'Choose what you want to find out. The AI decides what to check, our statistics compute every number.',
    goal: {
      what_changes: 'What changes most here?',
      why: 'Why does this variable change?',
      link: 'Are two things linked?',
      outlook: 'What comes next?',
      custom: 'My own hypothesis',
    },
    placeholder: {
      what_changes: 'Optional: what interests you most (heat, water, plants, air...)',
      why: 'Optional: your guess about the cause',
      link: 'Which two things? For example: rain and plant growth',
      outlook: 'Optional: what you want to know about the coming years',
      custom: 'Your hypothesis, for example: the soil dries because it rains less',
    },
    ask: 'Ask',
    working: 'The AI is checking the data, usually 20 to 40 seconds…',
    openVar: 'Open',
    next: 'Ask next',
    footer: 'Model {model}. Numbers come from our tests, not from the model; the wording may still be imperfect.',
    cached: 'from the cache',
    ownKey: 'Use my own Gemini key',
    ownKeyHint:
      'The key is kept only in this browser (IndexedDB). It goes to our server in the body of each request, is used for that request only and is never logged or stored. The code is public: backend/app/ai.py.',
    save: 'Save',
    remove: 'Remove my key',
    usingOwn: 'Your own key is used.',
    getKey: 'A free key: Google AI Studio.',
    err: {
      busy: 'The AI is under heavy load right now, try again in a minute. Your own Gemini key avoids the shared limit.',
      limit_ip: 'You asked several questions in a row. Try again in {min} min.',
      limit_day: 'The free AI of the site has used up its daily limit. Try tomorrow or use your own Gemini key.',
      quota_own: 'The limit of your key is used up, try again later.',
      bad_key: 'The key was not accepted. Check it in Google AI Studio.',
      server_key: 'The AI of the site is unavailable right now. You can use your own Gemini key.',
      no_key: 'The AI of the site is unavailable right now. You can use your own Gemini key.',
      model_unavailable: 'The model is overloaded or unavailable, try again later.',
      timeout: 'The AI did not answer in time, try again.',
      blocked: 'The model refused to answer this request.',
      off_topic: 'The AI detective only answers questions about trends in the data of this site. Rephrase the question.',
      need_text: 'Describe what exactly to check.',
      other: 'Something went wrong, try again.',
    },
  },
  ru: {
    open: 'Спросить ИИ-детектива',
    title: 'ИИ-детектив',
    intro: 'Выберите, что хотите выяснить. ИИ решает, что проверить, а каждое число считает наша статистика.',
    goal: {
      what_changes: 'Что здесь меняется сильнее всего?',
      why: 'Почему меняется этот показатель?',
      link: 'Связаны ли два явления?',
      outlook: 'Что будет дальше?',
      custom: 'Своя гипотеза',
    },
    placeholder: {
      what_changes: 'Необязательно: что интересует больше (жара, вода, растения, воздух…)',
      why: 'Необязательно: ваша догадка о причине',
      link: 'Какие два явления? Например: дожди и рост растений',
      outlook: 'Необязательно: что хотите узнать о ближайших годах',
      custom: 'Ваша гипотеза, например: почва сохнет, потому что дождей меньше',
    },
    ask: 'Спросить',
    working: 'ИИ проверяет данные, обычно от 20 до 40 секунд…',
    openVar: 'Открыть',
    next: 'Спросить дальше',
    footer: 'Модель {model}. Числа посчитаны нашими тестами, а не моделью; формулировки могут быть неточными.',
    cached: 'из кэша',
    ownKey: 'Использовать свой ключ Gemini',
    ownKeyHint:
      'Ключ хранится только в этом браузере (IndexedDB). На наш сервер он уходит в теле запроса, используется только для этого запроса и нигде не записывается. Код открыт: backend/app/ai.py.',
    save: 'Сохранить',
    remove: 'Удалить мой ключ',
    usingOwn: 'Используется ваш ключ.',
    getKey: 'Бесплатный ключ: Google AI Studio.',
    err: {
      busy: 'Слишком большая нагрузка на ИИ, попробуйте через минуту. Свой ключ Gemini позволяет обойти общий лимит.',
      limit_ip: 'Вы задали несколько вопросов подряд. Попробуйте через {min} мин.',
      limit_day: 'Бесплатный ИИ сайта исчерпал дневной лимит. Попробуйте завтра или используйте свой ключ Gemini.',
      quota_own: 'Лимит вашего ключа исчерпан, попробуйте позже.',
      bad_key: 'Ключ не подошёл. Проверьте его в Google AI Studio.',
      server_key: 'ИИ сайта сейчас недоступен. Можно использовать свой ключ Gemini.',
      no_key: 'ИИ сайта сейчас недоступен. Можно использовать свой ключ Gemini.',
      model_unavailable: 'Модель перегружена или недоступна, попробуйте позже.',
      timeout: 'ИИ не успел ответить, попробуйте ещё раз.',
      blocked: 'Модель отказалась отвечать на этот запрос.',
      off_topic: 'ИИ-детектив отвечает только на вопросы о трендах в данных этого сайта. Переформулируйте вопрос.',
      need_text: 'Опишите, что именно проверить.',
      other: 'Что-то пошло не так, попробуйте ещё раз.',
    },
  },
}

// the visitor's own key lives only here, in IndexedDB of this browser
const DB = 'trend-detective'
const STORE = 'keys'
function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB, 1)
      open.onupgradeneeded = () => open.result.createObjectStore(STORE)
      open.onerror = () => resolve(undefined)
      open.onsuccess = () => {
        const req = run(open.result.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(undefined)
      }
    } catch {
      resolve(undefined)
    }
  })
}
const readKey = () => idb<string>('readonly', (s) => s.get('gemini') as IDBRequest<string>)
const writeKey = (k: string) => idb('readwrite', (s) => s.put(k, 'gemini'))
const dropKey = () => idb('readwrite', (s) => s.delete('gemini'))

/** The AI detective: a goal for the current territory and variable, not a chat. */
export function AiDetective({
  variable,
  variables,
  target,
  startYear,
  simple,
  onPickVariable,
}: {
  variable: Variable | null
  variables: Variable[]
  target: Target
  startYear: number | null
  simple: boolean
  onPickVariable: (id: string) => void
}) {
  const { lang, l, num, unit } = useI18n()
  const s = T[lang === 'ru' ? 'ru' : 'en']
  const [open, setOpen] = useState(false)
  const [goal, setGoal] = useState<Goal>('what_changes')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [keyOpen, setKeyOpen] = useState(false)

  useEffect(() => {
    readKey().then((k) => setKey(k || null))
  }, [])

  // a new place or variable makes the old answer stale
  useEffect(() => {
    setAnswer(null)
    setError(null)
  }, [variable?.id, target])

  const nameOf = (id: string) => {
    const v = variables.find((x) => x.id === id)
    return v ? l(v.name) : id
  }

  const ask = async (g: Goal = goal, q: string = text) => {
    setBusy(true)
    setError(null)
    setAnswer(null)
    try {
      const r = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: g,
          text: q.trim() || null,
          mode: simple ? 'simple' : 'detailed',
          lang: lang === 'ru' ? 'ru' : 'en',
          variable: variable?.id ?? '',
          start_year: startYear,
          user_key: key ?? undefined,
          ...where(target),
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        const code = (d.code as keyof typeof s.err) ?? 'other'
        const msg = s.err[code] ?? s.err.other
        setError(msg.replace('{min}', String(Math.max(1, Math.ceil((d.retry_after ?? 60) / 60)))))
        return
      }
      setAnswer(d as Answer)
    } catch {
      setError(s.err.other)
    } finally {
      setBusy(false)
    }
  }

  const fact = (f: Finding) => {
    const e = f.evidence
    if (f.kind === 'trend' && e.per_decade !== undefined && e.per_decade !== null)
      return `${num(e.per_decade, 2, true)} ${unit(e.units ?? '')} / 10 ${lang === 'ru' ? 'лет' : 'yr'}`
    if (f.kind === 'link' && e.r !== undefined && e.r !== null)
      return `r = ${num(e.r, 2, true)}${e.lag_months ? `, ${Math.abs(e.lag_months)} ${lang === 'ru' ? 'мес.' : 'mo'}` : ''}`
    if (f.kind === 'profile' && e.levels) return `${e.levels.length} ${lang === 'ru' ? 'уровней' : 'levels'}`
    return ''
  }
  const proven = (f: Finding) => {
    const v = String(f.evidence.verdict ?? '')
    return v.startsWith('significant') || v.startsWith('linked')
  }

  if (!open)
    return (
      <button type="button" className="btn wide ai-open" onClick={() => setOpen(true)}>
        <Icon name="spark" /> {s.open}
      </button>
    )

  const needsText = goal === 'custom' || goal === 'link'
  return (
    <section className="ai-card">
      <h3>
        <Icon name="spark" /> {s.title}
      </h3>
      <p className="muted small">{s.intro}</p>
      <div className="ai-goals" role="group" aria-label={s.title}>
        {GOALS.map((g) => (
          <button type="button" key={g} aria-pressed={goal === g} className={`btn ${goal === g ? 'on' : ''}`} onClick={() => setGoal(g)}>
            {s.goal[g]}
          </button>
        ))}
      </div>
      <textarea
        className="ai-text"
        maxLength={MAX_TEXT}
        rows={2}
        value={text}
        placeholder={s.placeholder[goal]}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="ai-row">
        <span className="muted small">
          {text.length}/{MAX_TEXT}
        </span>
        <button type="button" className="btn primary" disabled={busy || (needsText && text.trim().length < 3)} onClick={() => ask()}>
          {s.ask}
        </button>
      </div>
      {busy && <p className="muted small">{s.working}</p>}
      {error && <p className="error small">{error}</p>}
      {answer && (
        <div className="ai-answer">
          <p className="ai-headline">{answer.headline}</p>
          <p>{answer.answer}</p>
          {answer.findings.length > 0 && (
            <ul className="ai-findings">
              {answer.findings.slice(0, simple ? 3 : 6).map((f) => (
                <li key={`${f.kind}-${f.variable}-${f.other ?? ''}`}>
                  <Mark ok={proven(f)} fail="open" />
                  <div>
                    <div>
                      <b>{f.kind === 'profile' ? f.variable.toUpperCase() : nameOf(f.variable)}</b>
                      {f.other ? ` ↔ ${nameOf(f.other)}` : ''} <span className="muted small">{fact(f)}</span>
                    </div>
                    <div className="small">{f.note}</div>
                  </div>
                  {f.kind !== 'profile' && variables.some((v) => v.id === f.variable) && (
                    <button type="button" className="btn small-btn" onClick={() => onPickVariable(f.variable)}>
                      {s.openVar}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {answer.next.length > 0 && (
            <div className="ai-next">
              <span className="muted small">{s.next}:</span>
              {answer.next.map((n) => (
                <button
                  type="button"
                  key={n}
                  className="btn small-btn"
                  onClick={() => {
                    setGoal('custom')
                    setText(n.slice(0, MAX_TEXT))
                    ask('custom', n.slice(0, MAX_TEXT))
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          <p className="muted small">
            {s.footer.replace('{model}', answer.model)}
            {answer.cached ? ` · ${s.cached}` : ''}
          </p>
        </div>
      )}
      <details className="ai-key" open={keyOpen} onToggle={(e) => setKeyOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="small">{s.ownKey}</summary>
        <p className="muted small">{s.ownKeyHint}</p>
        {key ? (
          <div className="ai-row">
            <span className="small">{s.usingOwn}</span>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                await dropKey()
                setKey(null)
              }}
            >
              {s.remove}
            </button>
          </div>
        ) : (
          <div className="ai-row">
            <input
              type="password"
              className="select"
              autoComplete="off"
              value={keyDraft}
              placeholder="AIza…"
              onChange={(e) => setKeyDraft(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              disabled={keyDraft.trim().length < 20}
              onClick={async () => {
                await writeKey(keyDraft.trim())
                setKey(keyDraft.trim())
                setKeyDraft('')
              }}
            >
              {s.save}
            </button>
          </div>
        )}
        <p className="muted small">
          {s.getKey}{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            aistudio.google.com
          </a>
        </p>
      </details>
    </section>
  )
}
