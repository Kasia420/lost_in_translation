import { gsap } from 'gsap'
import type { ResultRow } from '../lib/data'
import { findResult, resultValue } from '../lib/data'
import { integer, pValue, signed, unsigned } from '../lib/format'
import { contrast, cssVar, el, toHex } from '../lib/dom'

const ROLES: { token: string; name: string; use: string; text: boolean }[] = [
  { token: '--surface', name: 'Surface', use: 'page background', text: false },
  { token: '--surface-2', name: 'Raised surface', use: 'cards, tooltips', text: false },
  { token: '--line', name: 'Hairline', use: 'gridlines, borders (decorative)', text: false },
  { token: '--text', name: 'Text', use: 'headings, values', text: true },
  { token: '--text-2', name: 'Secondary text', use: 'body copy, labels', text: true },
  { token: '--text-3', name: 'Muted text', use: 'captions, axis notes', text: true },
  { token: '--en', name: 'English', use: 'every EN mark on the site', text: false },
  { token: '--pl', name: 'Polish', use: 'every PL mark on the site', text: false },
  { token: '--accent-3', name: 'Reserve', use: 'a third series, if ever needed', text: false },
]

/** Swatches show the live value of each token in the current direction and its contrast on the surface. */
export function mountSwatches(root: HTMLElement): () => void {
  const update = () => {
    const surface = toHex(cssVar('--surface'))
    root.replaceChildren(
      ...ROLES.map((r) => {
        const hex = toHex(cssVar(r.token))
        const ratio = r.token === '--surface' ? '' : ` · ${contrast(hex, surface).toFixed(1)}:1 on surface`
        const chip = el('div', { class: 'swatch__chip' })
        chip.style.background = hex
        return el('div', { class: 'swatch' }, [
          chip,
          el('div', { class: 'swatch__body' }, [
            el('span', { class: 'swatch__name', text: r.name }),
            el('span', { text: r.use }),
            el('span', { class: 'swatch__meta', text: `${r.token} ${hex}${ratio}` }),
          ]),
        ])
      }),
    )
  }
  update()
  return update
}

export function mountStats(root: HTMLElement, results: ResultRow[]): void {
  const cosV2 = findResult(results, { run: 'v2', section: 'homogenisation', measure: 'cosine(EN answer, PL answer)', subset: 'all' })
  const cosV1 = findResult(results, { run: 'v1', section: 'homogenisation', measure: 'cosine(EN answer, PL answer)', subset: 'all' })
  const sent = findResult(results, { run: 'v2', section: 'answer sentiment', measure: 'polarity, 512-token truncation (primary)', subset: 'all' })
  const cal = findResult(results, { run: 'calibration', section: 'classifier calibration (Tatoeba)', measure: 'polarity, 512-token truncation', subset: 'all' })
  const tile = (label: string, value: string, sub: string) =>
    el('div', { class: 'stat' }, [
      el('span', { class: 'label', text: label }),
      el('span', { class: 'figure stat__value', text: value }),
      el('span', { class: 'stat__sub', text: sub }),
    ])
  root.replaceChildren(
    tile('Median cosine, EN vs PL answer (v2)', unsigned(resultValue(cosV2, 'median_A')), `v1: ${unsigned(resultValue(cosV1, 'median_A'))} · n = ${cosV2.n} topics`),
    tile(
      'Median sentiment gap, PL − EN (v2)',
      signed(resultValue(sent, 'median_diff')),
      `p = ${pValue(resultValue(sent, 'p'))} · r = ${signed(resultValue(sent, 'rank_biserial'), 2)} · exploratory`,
    ),
    tile(
      'Tatoeba sentence pairs',
      integer(cal.n),
      `classifier shift PL − EN ${signed(resultValue(cal, 'median_diff'))} · p = ${pValue(resultValue(cal, 'p'))}`,
    ),
  )
}

/** Small motion samples; each button replays one effect. */
export function mountMotionDemos(root: HTMLElement, opts: { reducedMotion: boolean }): void {
  const words = { en: 'answer', pl: 'odpowiedź' }
  const scrambleStage = el('div', { class: 'display demo__stage', lang: 'en', text: words.en })
  let showingPl = false
  const scrambleBtn = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Play' })
  scrambleBtn.addEventListener('click', () => {
    showingPl = !showingPl
    const text = showingPl ? words.pl : words.en
    scrambleStage.lang = showingPl ? 'pl' : 'en'
    if (opts.reducedMotion) scrambleStage.textContent = text
    else gsap.to(scrambleStage, { duration: 1.2, scrambleText: { text, chars: 'abcdefghijklmnopqrstuvwxyząćęłńóśźż', speed: 0.6 } })
  })

  const counterStage = el('div', { class: 'figure demo__stage', text: '0' })
  const counterBtn = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Play' })
  counterBtn.addEventListener('click', () => {
    const o = { v: 0 }
    if (opts.reducedMotion) {
      counterStage.textContent = integer(1000)
      return
    }
    gsap.to(o, { v: 1000, duration: 1.4, ease: 'expo.out', onUpdate: () => (counterStage.textContent = integer(Math.round(o.v))) })
  })

  const lines = ['Same question,', 'two languages,', 'one model.']
  const revealStage = el(
    'div',
    { class: 'demo__stage', style: 'display:grid;font-size:20px;line-height:1.3;color:var(--text)' },
    lines.map((l) => el('span', { text: l })),
  )
  const revealBtn = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Play' })
  revealBtn.addEventListener('click', () => {
    if (opts.reducedMotion) return
    gsap.fromTo(revealStage.children, { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7, ease: 'expo.out', stagger: 0.09 })
  })

  const demo = (name: string, note: string, stage: HTMLElement, btn: HTMLElement) =>
    el('div', { class: 'demo' }, [el('span', { class: 'label', text: name }), stage, el('span', { class: 'stat__sub', text: note }), btn])

  root.replaceChildren(
    demo('Scramble', 'Titles and key words morph between EN and PL (1.2–1.9 s).', scrambleStage, scrambleBtn),
    demo('Counter', 'Numbers roll up from 0 when they appear (1.4 s, expo-out).', counterStage, counterBtn),
    demo('Reveal', 'Text and frames rise in as you scroll (0.7 s, expo-out, 90 ms stagger).', revealStage, revealBtn),
  )
}
