import type { DomainId, Lang, Meta, RunId, Topic } from '../lib/data'
import { el } from '../lib/dom'
import { signed, unsigned } from '../lib/format'
import { renderMarkdown } from '../lib/markdown'

/**
 * Read the answers: one topic at a time, the English and Polish answer side by
 * side, with the prompt as sent, every per-topic metric and both Wikipedia
 * leads. This is also the no-animation route to every number on the site.
 */
const DOMAIN_ORDER: DomainId[] = ['contested_history', 'literature', 'social_norms']
const LANG_NAME: Record<Lang, string> = { en: 'English', pl: 'Polish' }

export function mountExplorer(
  root: HTMLElement,
  opts: { topics: Topic[]; meta: Meta },
): { show(id: string): void; focusPicker(): void } {
  let run: RunId = 'v2'
  let index = 0
  const topics = DOMAIN_ORDER.flatMap((d) => opts.topics.filter((t) => t.domain === d))
  const domainLabel = new Map(opts.meta.domains.map((d) => [d.id, d.label]))

  // ---- controls ----
  const select = el('select', { id: 'explorer-topic', class: 'select' })
  for (const d of DOMAIN_ORDER) {
    const group = el('optgroup', { label: domainLabel.get(d) ?? d })
    for (const t of topics.filter((x) => x.domain === d)) group.append(el('option', { value: t.id, text: t.topic }))
    select.append(group)
  }
  select.addEventListener('change', () => show(select.value))
  const prev = el('button', { class: 'chip', type: 'button', text: '← Previous', 'aria-label': 'Previous topic' })
  const next = el('button', { class: 'chip', type: 'button', text: 'Next →', 'aria-label': 'Next topic' })
  prev.addEventListener('click', () => show(topics[(index - 1 + topics.length) % topics.length].id))
  next.addEventListener('click', () => show(topics[(index + 1) % topics.length].id))
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Run' })
  const runButtons = new Map<RunId, HTMLButtonElement>()
  for (const r of ['v2', 'v1'] as const) {
    const b = el('button', { type: 'button', text: `Answers ${r}` })
    b.addEventListener('click', () => {
      run = r
      render()
    })
    runButtons.set(r, b)
    seg.append(b)
  }
  const controls = el('div', { class: 'explorer__controls' }, [
    el('label', { class: 'explorer__pick', for: 'explorer-topic' }, [el('span', { class: 'label', text: 'Topic' }), select]),
    prev,
    next,
    seg,
  ])

  const metrics = el('dl', { class: 'explorer__metrics' })
  const columns = el('div', { class: 'explorer__columns' })
  const wiki = el('div', { class: 'explorer__wiki' })
  root.classList.add('explorer')
  root.replaceChildren(controls, metrics, columns, wiki)

  const metric = (name: string, value: string, note?: string) => [
    el('div', { class: 'metric' }, [
      el('dt', { class: 'label', text: name }),
      el('dd', {}, [el('span', { class: 'figure', text: value }), ...(note ? [el('small', { text: note })] : [])]),
    ]),
  ]

  function render() {
    const t = topics[index]
    const r = t.runs[run]
    for (const [k, b] of runButtons) b.setAttribute('aria-pressed', String(k === run))
    select.value = t.id

    const a = r.answers
    const status = (lang: Lang) => {
      const ans = a[lang]
      if (run === 'v2') return ans.stop_reason ?? ''
      return ans.ends_mid_sentence ? 'ends mid-sentence' : ''
    }
    metrics.replaceChildren(
      ...metric('Cosine EN–PL', unsigned(r.cosine_en_pl)),
      ...metric('Sentiment EN', signed(a.en.sentiment)),
      ...metric('Sentiment PL', signed(a.pl.sentiment)),
      ...metric('Native pull EN', r.native_pull.en === null ? '—' : signed(r.native_pull.en), r.native_pull.en === null ? 'no Wikipedia baseline' : undefined),
      ...metric('Native pull PL', r.native_pull.pl === null ? '—' : signed(r.native_pull.pl)),
      ...metric('Words EN / PL', `${a.en.words} / ${a.pl.words}`, `without markdown: ${a.en.words_clean} / ${a.pl.words_clean}`),
    )

    columns.replaceChildren(
      ...(['en', 'pl'] as const).map((lang) => {
        const ans = a[lang]
        const s = status(lang)
        return el('article', { class: `answer answer--${lang}`, lang, 'aria-label': `${LANG_NAME[lang]} answer` }, [
          el('header', { class: 'answer__head' }, [
            el('span', { class: 'answer__key' }, [el('i', { class: `key key--${lang}` }), `${LANG_NAME[lang]} answer · ${run}`]),
            el('span', { class: 'answer__meta', text: `${ans.words} words${s ? ` · ${s}` : ''}` }),
          ]),
          el('p', { class: 'answer__prompt' }, [el('span', { class: 'label', text: 'Prompt' }), ans.prompt_sent]),
          el('div', { class: 'answer__body md' }, [renderMarkdown(ans.text, { baseHeading: 4 })]),
        ])
      }),
    )

    if (t.wikipedia) {
      const w = t.wikipedia
      wiki.replaceChildren(
        el('p', { class: 'label', text: 'Wikipedia lead sections (human-written baseline, CC BY-SA 4.0)' }),
        ...(['en', 'pl'] as const).map((lang) =>
          el('details', { class: 'wiki', lang }, [
            el('summary', {}, [
              el('i', { class: `key key--hollow-${lang}` }),
              `${LANG_NAME[lang]} Wikipedia: ${w[lang].title} · sentiment ${signed(w[lang].sentiment)}`,
            ]),
            el('p', { class: 'wiki__lead', text: w[lang].lead }),
            el('a', { href: w[lang].url, target: '_blank', rel: 'noopener', text: w[lang].url }),
          ]),
        ),
      )
    } else {
      wiki.replaceChildren(el('p', { class: 'caption', text: 'This topic has no matching Wikipedia article, so it has no baseline.' }))
    }
  }

  function show(id: string) {
    const i = topics.findIndex((t) => t.id === id)
    if (i < 0) return
    index = i
    render()
  }

  render()
  return { show, focusPicker: () => select.focus({ preventScroll: true }) }
}
