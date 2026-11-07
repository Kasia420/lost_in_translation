import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/fraunces/wght-italic.css'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import 'lenis/dist/lenis.css'
import '../styles/tokens.css'
import '../styles/base.css'
import '../styles/components.css'
import './design.css'

import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import type { Lang } from '../lib/data'
import { findResult, loadSiteData } from '../lib/data'
import { UI } from '../lib/i18n'
import { mountCards } from '../components/cards'
import { mountCloud } from '../components/cloud'
import { el } from '../lib/dom'
import { initHero } from '../components/hero'
import { mountScatter } from '../components/scatter'
import { mountMotionDemos, mountStats, mountSwatches } from './styletile'
import { mountStoryboard } from './storyboard'

gsap.registerPlugin(ScrollTrigger)

type Direction = 'orbit' | 'archive' | 'lab'
const DIRECTIONS: Direction[] = ['orbit', 'archive', 'lab']

const html = document.documentElement
const params = new URLSearchParams(location.search)
const reducedMotion = params.get('motion') === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches
let direction: Direction = DIRECTIONS.find((d) => d === params.get('direction')) ?? 'orbit'
let lang: Lang = params.get('lang') === 'pl' ? 'pl' : 'en'

if (reducedMotion) html.dataset.motion = 'reduced'
html.dataset.direction = direction

const $ = <T extends Element = HTMLElement>(sel: string): T => {
  const node = document.querySelector<T>(sel)
  if (!node) throw new Error(`design page: missing ${sel}`)
  return node
}

function syncURL() {
  if (direction === 'orbit') params.delete('direction')
  else params.set('direction', direction)
  if (lang === 'en') params.delete('lang')
  else params.set('lang', lang)
  const qs = params.toString()
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`)
}

// ---- smooth scroll (off with reduced motion) ----
let lenis: Lenis | null = null
if (!reducedMotion) {
  lenis = new Lenis({ autoRaf: false, anchors: true })
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((time) => lenis?.raf(time * 1000))
  gsap.ticker.lagSmoothing(0)
}

// ---- hero + preloader ----
const hero = initHero($('#hero'), { reducedMotion, lang })
let filesFraction = 0
let fontsReady = false
const progress = () => hero.setProgress(filesFraction * 0.85 + (fontsReady ? 0.15 : 0))
void document.fonts.ready.then(() => {
  fontsReady = true
  progress()
})

const replayIntro = () => {
  if (lenis) lenis.scrollTo(0, { immediate: false })
  else window.scrollTo(0, 0)
  hero.replay()
}
$('#replay').addEventListener('click', replayIntro)

// ---- top bar: direction, language, motion ----
const swatchUpdaters: (() => void)[] = []
function setDirection(d: Direction) {
  direction = d
  html.dataset.direction = d
  document.querySelectorAll<HTMLButtonElement>('[data-set-direction]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.setDirection === d))
  })
  syncURL()
  // let the new custom properties apply before anything reads them
  requestAnimationFrame(() => {
    swatchUpdaters.forEach((fn) => fn())
    window.dispatchEvent(new CustomEvent('directionchange', { detail: d }))
  })
}
document.querySelectorAll<HTMLButtonElement>('[data-set-direction]').forEach((b) => {
  b.addEventListener('click', () => {
    const d = DIRECTIONS.find((x) => x === b.dataset.setDirection)
    if (d) setDirection(d)
  })
})

const langListeners: ((l: Lang) => void)[] = [(l) => hero.setLang(l)]
function setLang(l: Lang) {
  lang = l
  html.lang = l
  document.querySelectorAll<HTMLButtonElement>('[data-set-lang]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.setLang === l))
  })
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
    const key = node.dataset.i18n as keyof (typeof UI)['en']
    node.textContent = UI[l][key]
  })
  syncURL()
  langListeners.forEach((fn) => fn(l))
}
document.querySelectorAll<HTMLButtonElement>('[data-set-lang]').forEach((b) => {
  b.addEventListener('click', () => setLang(b.dataset.setLang === 'pl' ? 'pl' : 'en'))
})

const motionBtn = $<HTMLButtonElement>('#motion-toggle')
motionBtn.setAttribute('aria-pressed', String(reducedMotion))
motionBtn.textContent = reducedMotion ? 'Motion: reduced' : 'Motion: full'
motionBtn.addEventListener('click', () => {
  if (reducedMotion) params.delete('motion')
  else params.set('motion', 'reduced')
  location.search = params.toString()
})

setDirection(direction)
setLang(lang)

// ---- data + prototypes ----
loadSiteData((done, total) => {
  filesFraction = done / total
  progress()
})
  .then((data) => {
    // the intro plays in parallel; content never waits for an animation
    // (in a background tab animation frames are paused and it would never finish)
    void hero.finish()
    const { meta, topics, results, points } = data

    swatchUpdaters.push(mountSwatches($('#swatches')))
    mountStats($('#stats'), results)
    mountMotionDemos($('#motion-demos'), { reducedMotion })

    const tatoeba = findResult(results, {
      run: 'calibration',
      section: 'classifier calibration (Tatoeba)',
      measure: 'polarity, 512-token truncation',
      subset: 'all',
    })
    const mounts = mountStoryboard(
      $('#frames'),
      {
        topics: topics.length,
        answers: topics.length * 4,
        wikiLeads: topics.filter((t) => t.wikipedia).length * 2,
        tatoebaPairs: tatoeba.n,
        cloudPoints: points.length,
      },
      replayIntro,
    )

    const cards = mountCards(mounts.get('cards')!, topics, { lang, lengthInstruction: meta.runs.v2.length_instruction })
    langListeners.push((l) => cards.setLang(l))
    mountCloud(mounts.get('cloud')!, { topics, points, meta, reducedMotion, direction })
    mountScatter(mounts.get('scatter')!, { topics, results, meta, views: ['v2', 'v1'], initial: 'v2', wide: true, reducedMotion })
    mountScatter(mounts.get('scatter-wiki')!, {
      topics,
      results,
      meta,
      views: ['v2', 'wiki'],
      initial: 'v2',
      showGapTest: true,
      wide: true,
      reducedMotion,
    })

    $('#source-commit').textContent = meta.source_commit ?? 'unknown'

    if (!reducedMotion) {
      gsap.utils.toArray<HTMLElement>('.reveal').forEach((node) => {
        gsap.from(node, {
          y: 28,
          autoAlpha: 0,
          duration: 0.8,
          ease: 'expo.out',
          scrollTrigger: { trigger: node, start: 'top 88%', once: true },
        })
      })
    }
    ScrollTrigger.refresh()

    console.log(
      '%cLost in Translation%c\nHi, curious engineer. Every number on this page comes from site/public/data/*.json,\n' +
        `exported from commit ${meta.source_commit} and checked against results/results_table.csv during the export.\n` +
        `Repository: ${meta.repository}`,
      'font: 600 14px system-ui',
      'font: 12px ui-monospace, monospace',
    )
  })
  .catch((err: unknown) => {
    console.error(err)
    document.querySelector('main')?.prepend(
      el('div', { class: 'error', role: 'alert' }, [
        el('strong', { text: 'Error: ' }),
        `the data could not be loaded (${err instanceof Error ? err.message : String(err)}).`,
      ]),
    )
    void hero.finish()
  })
