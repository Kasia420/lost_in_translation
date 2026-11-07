import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/jetbrains-mono'
import 'lenis/dist/lenis.css'
import '../styles/tokens.css'
import '../styles/base.css'
import '../styles/components.css'
import '../styles/site.css'

import { extent, ticks } from 'd3'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import requirementsRaw from '../../../requirements.txt?raw'
import pkg from '../../package.json'
import { mountCards } from '../components/cards'
import { type DumbbellView, mountDumbbell } from '../components/dumbbell'
import { mountExplorer } from '../components/explorer'
import { initHero } from '../components/hero'
import { mountHistogram } from '../components/histogram'
import { mountScatter } from '../components/scatter'
import {
  README_URL,
  REPORT_URL,
  codeBlock,
  leadParagraph,
  listItem,
  paragraphs,
  paragraphsAfterCode,
  reportByline,
  reportTitle,
} from '../lib/copy'
import type { Meta, ResultRow, RunId, Topic } from '../lib/data'
import { findResult, loadSiteData, loadTatoeba, resultValue } from '../lib/data'
import { el } from '../lib/dom'
import { integer, pValue, signed, unsigned } from '../lib/format'
import { renderInline } from '../lib/markdown'

gsap.registerPlugin(ScrollTrigger)

const REPO = 'https://github.com/Kasia420/lost_in_translation'
const html = document.documentElement
const params = new URLSearchParams(location.search)
const reducedMotion = params.get('motion') === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches
if (reducedMotion) html.dataset.motion = 'reduced'

const $ = <T extends Element = HTMLElement>(sel: string): T => {
  const node = document.querySelector<T>(sel)
  if (!node) throw new Error(`site: missing ${sel}`)
  return node
}

// ---- text: Kasia's report, verbatim ----
// non-breaking spaces keep “p = .0004” and “n = 24” on one line (typography only, wording unchanged)
const glue = (text: string) => text.replace(/\b([pnrW]) = /g, '$1\u00a0=\u00a0')
const inline = (text: string) => renderInline(glue(text), { referenceUrl: REPORT_URL })
const para = (text: string) => {
  const p = el('p')
  p.append(inline(text))
  return p
}
const prose = (sel: string, texts: string[]) => $(sel).replaceChildren(...texts.map(para))
const withoutLead = (text: string) => text.replace(/^\*\*[^*]+\*\*\s*/, '') // the page already labels it

const DESIGN = 'question and design'
const title = reportTitle()
$('#hero-kicker').textContent = title.includes(': ') ? title.slice(title.indexOf(': ') + 2) : title
$('#hero-question').append(inline(withoutLead(leadParagraph('report', DESIGN, 'Research question.'))))
prose('#abstract', paragraphs('report', 'abstract'))
prose('#design-text', [leadParagraph('report', DESIGN, 'Design.')])
$('#h1').append(inline(listItem('report', DESIGN, '**H1')))
$('#h2').append(inline(listItem('report', DESIGN, '**H2')))
$('#h3').append(inline(listItem('report', DESIGN, '**H3')))
prose('#similarity-text', paragraphs('report', 'cross-lingual similarity'))
prose('#sentiment-text', paragraphs('report', 'sentiment of the answers'))
const reference = paragraphs('report', 'reference points: wikipedia and classifier calibration')
prose('#wiki-text', [reference[0]])
prose('#calibration-text', [reference[1]])
prose('#wiki-interpretation', [leadParagraph('report', 'interpretation', 'Wikipedia as a reference point.')])
prose('#calibration-interpretation', [leadParagraph('report', 'interpretation', 'Classifier calibration.')])
prose('#anchoring-text', paragraphs('report', 'anchoring in native-language discourse'))
prose('#anchoring-interpretation', [leadParagraph('report', 'interpretation', 'Native pull.')])
prose('#conclusion', [leadParagraph('report', 'interpretation', 'Conclusion.')])
prose('#limitations', paragraphs('report', 'limitations'))
prose('#measures', [leadParagraph('report', DESIGN, 'Measures.')])
{
  const after = paragraphsAfterCode('report', 'reproducibility')
  const before = paragraphs('report', 'reproducibility').filter((p) => !after.includes(p))
  const pre = el('pre', { class: 'code' }, [el('code', { text: codeBlock('report', 'reproducibility') })])
  $('#repro').replaceChildren(...before.map(para), pre, ...after.map(para))
}
prose('#ai-note', paragraphs('readme', 'ai assistance'))
prose('#byline', [reportByline()])
for (const sel of ['#nav-report', '#hero-report']) $<HTMLAnchorElement>(sel).href = REPORT_URL

// ---- contents + current chapter in the nav ----
const chapters = [...document.querySelectorAll<HTMLElement>('section.chapter[id]')].filter((s) => s.id !== 'short')
$('#contents-list').replaceChildren(
  ...chapters.map((s) => {
    const no = s.querySelector('.chapter__no')?.textContent ?? ''
    const name = s.querySelector('h2')?.textContent ?? s.id
    return el('li', {}, [el('a', { href: `#${s.id}` }, [el('span', { class: 'contents__no', text: no }), name])])
  }),
)
const navChapter = $('.nav__chapter')
const chapterObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) if (e.isIntersecting) navChapter.textContent = (e.target as HTMLElement).dataset.chapter ?? ''
  },
  { rootMargin: '-45% 0px -50% 0px' },
)
document.querySelectorAll('[data-chapter]').forEach((s) => chapterObserver.observe(s))

// ---- motion: smooth scroll, progress bar, toggle ----
let lenis: Lenis | null = null
if (!reducedMotion) {
  lenis = new Lenis({ autoRaf: false, anchors: true })
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((time) => lenis?.raf(time * 1000))
  gsap.ticker.lagSmoothing(0)
}
const bar = $('.progress span')
ScrollTrigger.create({
  start: 0,
  end: 'max',
  onUpdate: (self) => {
    bar.style.transform = `scaleX(${self.progress})`
  },
})
const motionBtn = $<HTMLButtonElement>('#motion-toggle')
motionBtn.textContent = reducedMotion ? 'Motion off' : 'Motion on'
motionBtn.setAttribute('aria-pressed', String(!reducedMotion))
motionBtn.title = reducedMotion ? 'Turn animations on' : 'Turn animations off'
motionBtn.addEventListener('click', () => {
  if (reducedMotion) params.delete('motion')
  else params.set('motion', 'reduced')
  location.search = params.toString()
})

// ---- hero + loading ----
const hero = initHero($('#top'), { reducedMotion, lang: 'en' })
let filesFraction = 0
let fontsReady = false
const progress = () => hero.setProgress(filesFraction * 0.85 + (fontsReady ? 0.15 : 0))
void document.fonts.ready.then(() => {
  fontsReady = true
  progress()
})

/** Run `fn` once, when `node` comes within `margin` of the viewport. */
function whenNear(node: Element, margin: string, fn: () => void | Promise<void>) {
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      void Promise.resolve(fn()).then(() => ScrollTrigger.refresh())
    },
    { rootMargin: margin },
  )
  io.observe(node)
}

// ---- chapters that need data ----
function counters(topics: Topic[], results: ResultRow[]) {
  const cal = findResult(results, {
    run: 'calibration',
    section: 'classifier calibration (Tatoeba)',
    measure: 'polarity, 512-token truncation',
    subset: 'all',
  })
  const items: [number, string][] = [
    [topics.length, 'topics, each asked in English and in Polish'],
    [topics.length * 4, 'answers (two runs × two languages)'],
    [topics.filter((t) => t.wikipedia).length * 2, 'Wikipedia lead sections (EN and PL)'],
    [cal.n, 'Tatoeba sentence pairs for the calibration check'],
  ]
  const root = $('#counters')
  const values = items.map(([n]) => el('span', { class: 'figure counter__value', text: reducedMotion ? integer(n) : '0' }))
  root.replaceChildren(
    ...items.map(([, label], i) => el('div', { class: 'counter' }, [values[i], el('span', { class: 'counter__label', text: label })])),
  )
  if (!reducedMotion) {
    ScrollTrigger.create({
      trigger: root,
      start: 'top 85%',
      once: true,
      onEnter: () =>
        items.forEach(([n], i) => {
          const o = { v: 0 }
          gsap.to(o, { v: n, duration: 1.4, ease: 'expo.out', delay: i * 0.08, onUpdate: () => (values[i].textContent = integer(Math.round(o.v))) })
        }),
    })
  }
}

function settings(meta: Meta) {
  const r = meta.runs
  const instr = (run: RunId) => {
    const li = r[run].length_instruction
    return li ? `“${li.en}” / “${li.pl}”` : 'none'
  }
  const rows: [string, string, string][] = [
    ['Model requested', r.v1.model, r.v2.model],
    ['Temperature', String(r.v1.temperature), String(r.v2.temperature)],
    ['max_tokens', String(r.v1.max_tokens), String(r.v2.max_tokens)],
    ['Length instruction', instr('v1'), instr('v2')],
    ['Notes', meta.run_notes.v1, meta.run_notes.v2],
  ]
  $('#settings').replaceChildren(
    el('h3', { class: 'chart__title', text: 'Two runs' }),
    el('div', { class: 'tablewrap' }, [
      el('table', { class: 'settings' }, [
        el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: '' }), el('th', { scope: 'col', text: 'v1' }), el('th', { scope: 'col', text: 'v2' })])]),
        el('tbody', {}, rows.map(([k, a, b]) => el('tr', {}, [el('th', { scope: 'row', text: k }), el('td', { text: a }), el('td', { text: b })]))),
      ]),
    ]),
  )
}

function cosineStats(meta: Meta, results: ResultRow[]) {
  const q = (run: string, subset: string) =>
    findResult(results, { run, section: 'homogenisation', measure: 'cosine(EN answer, PL answer)', subset })
  const v1 = q('v1', 'all')
  const v2 = q('v2', 'all')
  const tile = el('div', { class: 'stat' }, [
    el('span', { class: 'label', text: 'Median cosine, EN vs PL answer' }),
    el('span', { class: 'figure stat__value', text: unsigned(resultValue(v2, 'median_A')) }),
    el('span', { class: 'stat__sub', text: `v2 · v1: ${unsigned(resultValue(v1, 'median_A'))} · n = ${v2.n} topics` }),
  ])
  const table = el('table', { class: 'settings settings--compact' }, [
    el('caption', { text: 'Median cosine by domain' }),
    el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: 'Domain' }), el('th', { scope: 'col', class: 'num', text: 'n' }), el('th', { scope: 'col', class: 'num', text: 'v1' }), el('th', { scope: 'col', class: 'num', text: 'v2' })])]),
    el(
      'tbody',
      {},
      meta.domains.map((d) => {
        const a = q('v1', d.label)
        const b = q('v2', d.label)
        return el('tr', {}, [
          el('th', { scope: 'row', text: d.label }),
          el('td', { class: 'num', text: String(b.n) }),
          el('td', { class: 'num', text: unsigned(resultValue(a, 'median_A')) }),
          el('td', { class: 'num', text: unsigned(resultValue(b, 'median_A')) }),
        ])
      }),
    ),
  ])
  $('#cosine-stats').replaceChildren(tile, el('div', { class: 'tablewrap' }, [table]))
}

const minus = (v: number) => (v < 0 ? `−${Math.abs(v)}` : String(v))

function nativePull(topics: Topic[], results: ResultRow[], onOpen: (id: string) => void) {
  const withBase = topics.filter((t) => t.wikipedia)
  const values = withBase.flatMap((t) => (['v1', 'v2'] as const).flatMap((r) => [t.runs[r].native_pull.en ?? 0, t.runs[r].native_pull.pl ?? 0]))
  const [lo0, hi0] = extent(values) as [number, number]
  const lo = Math.floor((lo0 - 0.02) / 0.05) * 0.05
  const hi = Math.ceil((hi0 + 0.02) / 0.05) * 0.05
  const views: DumbbellView[] = (['v2', 'v1'] as const).map((run) => {
    const r = findResult(results, { run, section: 'native pull', measure: 'sim(own-lang wiki) - sim(other-lang wiki)', subset: 'all' })
    return {
      id: run,
      button: `Answers ${run}`,
      title: `Native pull of the English and the Polish answer, ${run}`,
      subtitle: [
        `n = ${r.n}`,
        `medians EN ${signed(resultValue(r, 'median_A'))}, PL ${signed(resultValue(r, 'median_B'))}`,
        `Wilcoxon p = ${pValue(resultValue(r, 'p'))}`,
        `r = ${signed(resultValue(r, 'rank_biserial'), 2)} (EN − PL)`,
      ].join(' · '),
      rows: withBase.map((t) => ({
        id: t.id,
        topic: t.topic,
        domain: t.domain,
        domainLabel: t.domain_label,
        en: t.runs[run].native_pull.en ?? 0,
        pl: t.runs[run].native_pull.pl ?? 0,
      })),
      medians: { en: resultValue(r, 'median_A'), pl: resultValue(r, 'median_B') },
      reference: { value: 0, label: '0: equally similar to both Wikipedia leads' },
      exploratory: run === 'v2',
    }
  })
  mountDumbbell($('#native-pull'), {
    views,
    initial: 'v2',
    xLabel: 'Similarity to the own-language lead minus similarity to the other-language lead',
    xLabelShort: 'Native pull (LaBSE cosine difference)',
    domain: [lo, hi],
    ticks: ticks(lo, hi, 6),
    tickFormat: (v) => (v === 0 ? '0' : signed(v, 2)),
    format: (v) => signed(v),
    start: 0,
    caption:
      'Native pull: how much closer an answer is to the Wikipedia lead in its own language than to the lead in the other language ' +
      '(LaBSE cosine). Topic s06 has no Wikipedia article and is left out (n = 24).',
    tableCaption: 'native pull per topic',
    onOpen,
    reducedMotion,
  })
}

function lengths(meta: Meta, topics: Topic[], results: ResultRow[], onOpen: (id: string) => void) {
  const instruction = meta.runs.v2.length_instruction?.en ?? ''
  const target = Number(instruction.match(/\d+/)?.[0] ?? Number.NaN)
  const max = Math.max(...topics.flatMap((t) => (['v1', 'v2'] as const).flatMap((r) => [t.runs[r].answers.en.words, t.runs[r].answers.pl.words])))
  const hi = Math.ceil(max / 50) * 50
  const views: DumbbellView[] = (['v2', 'v1'] as const).map((run) => {
    const r = findResult(results, { run, section: 'length', measure: 'n_words (whitespace tokens)', subset: 'all' })
    return {
      id: run,
      button: `Answers ${run}`,
      title: `Words per answer, English vs Polish, ${run}`,
      subtitle: [
        `n = ${r.n}`,
        `medians EN ${resultValue(r, 'median_A')}, PL ${resultValue(r, 'median_B')}`,
        `median EN − PL ${minus(resultValue(r, 'median_diff'))} words (descriptive)`,
      ].join(' · '),
      rows: topics.map((t) => ({
        id: t.id,
        topic: t.topic,
        domain: t.domain,
        domainLabel: t.domain_label,
        en: t.runs[run].answers.en.words,
        pl: t.runs[run].answers.pl.words,
      })),
      medians: { en: resultValue(r, 'median_A'), pl: resultValue(r, 'median_B') },
      reference: run === 'v2' && Number.isFinite(target) ? { value: target, label: `v2 instruction: “${instruction}”` } : undefined,
    }
  })
  mountDumbbell($('#lengths'), {
    views,
    initial: 'v2',
    xLabel: 'Words per answer (whitespace-separated tokens)',
    xLabelShort: 'Words per answer',
    domain: [0, hi],
    ticks: ticks(0, hi, 7),
    tickFormat: (v) => String(v),
    format: minus,
    start: 0,
    caption:
      `v1 capped answers at max_tokens = ${meta.runs.v1.max_tokens}; v2 asked for about ${target} words in the prompt ` +
      `(max_tokens = ${meta.runs.v2.max_tokens}). Word counts without markdown are in the answer explorer.`,
    tableCaption: 'words per answer',
    onOpen,
    reducedMotion,
  })
}

function underTheHood(meta: Meta) {
  const src = (p: string) => `${REPO}/blob/main/${p}`
  const steps: [string, string, string[]][] = [
    ['Collect', 'Claude answers the 25 prompts in English and Polish; Wikipedia lead sections for the same topics.', ['src/collect.py', 'src/wiki.py']],
    ['Analyse', 'LaBSE similarity, XLM-R sentiment, paired Wilcoxon tests, calibration on Tatoeba.', ['src/analyze.py', 'src/extended.py', 'src/calibration.py', 'src/tables.py']],
    ['Export', 'JSON for this site; the export rebuilds every row of the results table and stops on any mismatch.', ['src/site_export.py']],
    ['Site', 'Vite, TypeScript, D3, Three.js and GSAP; every number is read from the exported JSON.', ['site/']],
  ]
  $('#pipeline').replaceChildren(
    ...steps.map(([name, text, files], i) =>
      el('li', { class: 'pipeline__step' }, [
        el('span', { class: 'label', text: `0${i + 1}` }),
        el('h4', { class: 'pipeline__name', text: name }),
        el('p', { text }),
        el(
          'p',
          { class: 'pipeline__files' },
          files.flatMap((f, k) => [...(k ? [' · '] : []), el('a', { href: f.endsWith('/') ? `${REPO}/tree/main/${f}` : src(f), target: '_blank', rel: 'noopener', text: f })]),
        ),
      ]),
    ),
  )
  const base = import.meta.env.BASE_URL
  const files: [string, string][] = [
    ['topics.json', 'prompts, answers, Wikipedia leads and every per-topic metric'],
    ['results.json', 'all tests of results/results_table.csv'],
    ['embeddings3d.json', 'the 3D map of the LaBSE embeddings'],
    ['tatoeba.json', 'the 1,000 calibration pairs'],
    ['meta.json', `settings, models, licences; exported from commit ${meta.source_commit ?? 'unknown'}`],
  ]
  $('#files').replaceChildren(
    ...files.map(([f, what]) => el('li', {}, [el('a', { href: `${base}data/${f}`, text: f }), ` · ${what}`])),
  )

  const pins = new Map(
    requirementsRaw
      .split('\n')
      .map((l) => l.trim().match(/^([A-Za-z0-9_.-]+)==([^\s;#]+)/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => [m[1].toLowerCase(), m[2]] as const),
  )
  const dep = (name: string) => (pkg.dependencies as Record<string, string>)[name] ?? (pkg.devDependencies as Record<string, string>)[name]
  const py = ['pandas', 'scipy', 'torch', 'transformers', 'sentence-transformers', 'anthropic'].filter((n) => pins.has(n))
  const js = ['vite', 'typescript', 'd3', 'three', 'gsap', 'lenis'].filter((n) => dep(n))
  $('#stack').replaceChildren(
    el('li', { text: `Python: ${py.map((n) => `${n} ${pins.get(n)}`).join(' · ')}` }),
    el('li', { text: `Site: ${js.map((n) => `${n} ${dep(n)}`).join(' · ')}` }),
  )
}

function about() {
  const links: [string, string][] = [
    ['Repository', REPO],
    ['Report', REPORT_URL],
    ['README', README_URL],
    ['GitHub profile', 'https://github.com/Kasia420'],
  ]
  $('#links').replaceChildren(...links.map(([t, href]) => el('li', {}, [el('a', { class: 'btn btn--ghost', href, target: '_blank', rel: 'noopener', text: t })])))
}

function footer(meta: Meta) {
  const a = (text: string, href: string) => el('a', { href, target: '_blank', rel: 'noopener', text })
  $('#footer').replaceChildren(
    el('p', {}, ['Study and text: Katarzyna Frąckowiak, from the ', a('report', REPORT_URL), ' and the ', a('README', README_URL), '.']),
    el('p', {}, [
      'Code: MIT. Data: CC BY-SA 4.0 (includes Wikipedia text). Tatoeba sentences: CC BY 2.0 FR. ',
      'Answers generated with Claude through the Anthropic API. Fonts: Space Grotesk, JetBrains Mono (SIL Open Font License).',
    ]),
    el('p', { text: `Data exported from commit ${meta.source_commit ?? 'unknown'}.` }),
  )
}

loadSiteData((done, total) => {
  filesFraction = done / total
  progress()
})
  .then(({ meta, topics, results, points }) => {
    void hero.finish() // content never waits for an animation

    // every chart can open a topic in the answer explorer (chapter 09)
    const explorer = mountExplorer($('#explorer'), { topics, meta })
    const openTopic = (id: string) => {
      explorer.show(id)
      // finish the chapter's reveal now: an element that is still invisible cannot take focus
      for (const t of gsap.getTweensOf('#answers .reveal')) t.progress(1).kill()
      const target = $('#answers')
      const focus = () => explorer.focusPicker()
      // lazy chapters may grow the page during the scroll, so land again precisely at the end
      if (lenis)
        lenis.scrollTo(target, {
          offset: -40,
          onComplete: () => {
            lenis?.scrollTo(target, { offset: -40, immediate: true, force: true })
            focus()
          },
        })
      else {
        target.scrollIntoView()
        focus()
      }
    }

    counters(topics, results)
    mountCards($('#cards'), topics, { lang: 'en', lengthInstruction: meta.runs.v2.length_instruction, all: true, domains: meta.domains })
    settings(meta)
    cosineStats(meta, results)
    whenNear($('#cloud'), '900px 0px', async () => {
      const { mountCloud } = await import('../components/cloud')
      mountCloud($('#cloud'), { topics, points, meta, reducedMotion, direction: 'orbit', onOpenTopic: openTopic })
    })
    mountScatter($('#scatter'), { topics, results, meta, views: ['v2', 'v1'], initial: 'v2', wide: true, onOpen: openTopic, reducedMotion })
    mountScatter($('#scatter-wiki'), {
      topics,
      results,
      meta,
      views: ['v2', 'wiki'],
      initial: 'v2',
      showGapTest: true,
      wide: true,
      onOpen: openTopic,
      reducedMotion,
    })
    whenNear($('#histogram'), '1200px 0px', async () => {
      const data = await loadTatoeba()
      mountHistogram($('#histogram'), { data, results, reducedMotion })
    })
    nativePull(topics, results, openTopic)
    lengths(meta, topics, results, openTopic)
    underTheHood(meta)
    about()
    footer(meta)

    if (!reducedMotion) {
      gsap.utils.toArray<HTMLElement>('.reveal').forEach((node) => {
        gsap.from(node, { y: 28, autoAlpha: 0, duration: 0.8, ease: 'expo.out', scrollTrigger: { trigger: node, start: 'top 90%', once: true } })
      })
    }
    ScrollTrigger.refresh()

    console.log(
      '%cLost in Translation%c\nHi, curious engineer. Every number on this page is read from data/*.json, exported from\n' +
        `commit ${meta.source_commit} and checked against results/results_table.csv during the export. Text: docs/portfolio_report.md.\n` +
        `Source: ${REPO}`,
      'font: 600 14px system-ui',
      'font: 12px ui-monospace, monospace',
    )
  })
  .catch((err: unknown) => {
    console.error(err)
    $('main').prepend(
      el('div', { class: 'error container', role: 'alert' }, [
        el('strong', { text: 'Error: ' }),
        `the data could not be loaded (${err instanceof Error ? err.message : String(err)}).`,
      ]),
    )
    void hero.finish()
  })
