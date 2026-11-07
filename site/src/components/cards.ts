import type { DomainId, Lang, Topic } from '../lib/data'
import { el } from '../lib/dom'
import { symbolIcon } from './scatter'

/**
 * Prompt cards: EN prompt on the front, PL prompt on the back.
 * Click (or Enter / Space) flips a card. `all` shows every topic with a
 * domain filter; otherwise the first topic of each domain.
 */
export function mountCards(
  root: HTMLElement,
  topics: Topic[],
  opts: {
    lang: Lang
    lengthInstruction: Record<Lang, string> | null
    all?: boolean
    domains?: { id: DomainId; label: string }[]
  },
): { setLang(lang: Lang): void } {
  const seen = new Set<DomainId>()
  const picked = opts.all ? topics : topics.filter((t) => (seen.has(t.domain) ? false : (seen.add(t.domain), true)))

  const face = (t: Topic, lang: Lang) =>
    el('span', { class: `pcard__face pcard__face--${lang}`, lang }, [
      el('span', { class: 'pcard__top' }, [
        el('span', { class: `key key--${lang}`, 'aria-hidden': 'true' }),
        el('span', { class: 'label', text: `${lang === 'en' ? 'English' : 'Polish'} prompt · ${t.id}` }),
      ]),
      el('span', { class: 'pcard__text', text: t.prompt[lang] }),
      el('span', { class: 'pcard__meta', text: `${t.domain_label} · ${t.topic}` }),
    ])

  const cards = picked.map((t) => {
    const en = face(t, 'en')
    const pl = face(t, 'pl')
    const btn = el('button', { class: 'pcard', type: 'button', 'aria-pressed': 'false', 'data-domain': t.domain }, [
      el('span', { class: 'pcard__inner' }, [en, pl]),
    ])
    const set = (flipped: boolean) => {
      btn.setAttribute('aria-pressed', String(flipped))
      en.setAttribute('aria-hidden', String(flipped))
      pl.setAttribute('aria-hidden', String(!flipped))
    }
    btn.addEventListener('click', () => set(btn.getAttribute('aria-pressed') !== 'true'))
    return { btn, set, domain: t.domain }
  })

  const grid = el('div', { class: `cards${opts.all ? ' cards--all' : ''}` }, cards.map((c) => c.btn))
  const parts: Node[] = []

  if (opts.all && opts.domains) {
    const chips = new Map<DomainId | 'all', HTMLButtonElement>()
    const row = el('div', { class: 'chart__controls', role: 'group', 'aria-label': 'Filter prompts by domain' })
    const setFilter = (f: DomainId | 'all') => {
      for (const [k, b] of chips) b.setAttribute('aria-pressed', String(k === f))
      for (const c of cards) c.btn.hidden = f !== 'all' && c.domain !== f
    }
    const all = el('button', { class: 'chip', type: 'button', text: `All ${cards.length}` })
    all.addEventListener('click', () => setFilter('all'))
    chips.set('all', all)
    row.append(all)
    for (const d of opts.domains) {
      const n = cards.filter((c) => c.domain === d.id).length
      const b = el('button', { class: 'chip', type: 'button' }, [symbolIcon(d.id), `${d.label} (${n})`])
      b.addEventListener('click', () => setFilter(d.id))
      chips.set(d.id, b)
      row.append(b)
    }
    const flipAll = el('button', { class: 'chip', type: 'button', text: 'Flip all' })
    flipAll.addEventListener('click', () => {
      const anyFront = cards.some((c) => c.btn.getAttribute('aria-pressed') !== 'true')
      cards.forEach((c) => c.set(anyFront))
    })
    row.append(flipAll)
    setFilter('all')
    parts.push(row)
  }

  parts.push(grid)
  if (opts.lengthInstruction) {
    parts.push(
      el('p', {
        class: 'cards-note',
        text: `Base prompts, as in v1. v2 appended “${opts.lengthInstruction.en}” / “${opts.lengthInstruction.pl}” to every prompt.`,
      }),
    )
  }
  root.replaceChildren(...parts)

  const setLang = (lang: Lang) => cards.forEach((c) => c.set(lang === 'pl'))
  setLang(opts.lang)
  return { setLang }
}
