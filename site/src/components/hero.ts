import { gsap } from 'gsap'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
import type { Lang } from '../lib/data'
import { TITLE } from '../lib/i18n'

gsap.registerPlugin(ScrambleTextPlugin)

/** Scramble alphabet: both languages' letters, so the morph "passes through" Polish. */
const CHARS = 'abcdefghijklmnopqrstuvwxyząćęłńóśźż'
const HOLD_SECONDS = 4

export interface Hero {
  /** Fraction 0..1 of real loading work done (data files + fonts). */
  setProgress(fraction: number): void
  /** Count to 100 %, hide the preloader, assemble the title, start the EN ⇄ PL morph. */
  finish(): Promise<void>
  replay(): void
  setLang(lang: Lang): void
}

export function initHero(root: HTMLElement, opts: { reducedMotion: boolean; lang: Lang }): Hero {
  const q = <T extends Element>(sel: string): T => {
    const el = root.querySelector<T>(sel)
    if (!el) throw new Error(`hero: missing ${sel}`)
    return el
  }
  const preloader = q<HTMLElement>('.preloader')
  const count = q<HTMLElement>('.preloader__count')
  const bar = q<HTMLElement>('.preloader__bar span')
  const anim = q<HTMLElement>('.hero__title-anim')
  const srTitle = q<HTMLElement>('.hero__title-sr')
  const inner = q<HTMLElement>('.hero__inner')

  let lang: Lang = opts.lang
  let shown: Lang = lang
  let finished = false
  let next: gsap.core.Tween | null = null
  let inView = true
  const counter = { v: 0 }

  const draw = () => {
    const v = Math.round(counter.v)
    count.textContent = String(v)
    bar.style.transform = `scaleX(${v / 100})`
  }

  const stopCycle = () => {
    next?.kill()
    next = null
  }

  const morphTo = (target: Lang, duration = 1.6) => {
    shown = target
    anim.lang = target
    gsap.to(anim, {
      duration,
      ease: 'none',
      scrambleText: { text: TITLE[target], chars: CHARS, revealDelay: 0.25, speed: 0.55 },
    })
  }

  const scheduleCycle = () => {
    stopCycle()
    if (opts.reducedMotion || !inView || !finished) return
    next = gsap.delayedCall(HOLD_SECONDS, () => {
      morphTo(shown === 'en' ? 'pl' : 'en')
      scheduleCycle()
    })
  }

  // pause the morph while the hero is off screen
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting
    if (inView) scheduleCycle()
    else stopCycle()
  }).observe(root)

  const showStatic = () => {
    preloader.hidden = true
    anim.lang = lang
    anim.textContent = TITLE[lang]
    gsap.set(inner, { autoAlpha: 1 })
  }

  srTitle.textContent = TITLE[lang]
  if (opts.reducedMotion) {
    showStatic()
  } else {
    gsap.set(inner, { autoAlpha: 0 })
    draw()
  }

  const finish = (): Promise<void> =>
    new Promise((resolve) => {
      if (opts.reducedMotion) {
        finished = true
        showStatic()
        resolve()
        return
      }
      gsap
        .timeline({
          onComplete: () => {
            finished = true
            scheduleCycle()
            resolve()
          },
        })
        .to(counter, { v: 100, duration: 0.45, ease: 'power2.out', onUpdate: draw })
        .to(preloader, { autoAlpha: 0, duration: 0.7, ease: 'power2.inOut' }, '+=0.15')
        .add(() => {
          anim.textContent = ''
        })
        .to(inner, { autoAlpha: 1, duration: 0.6 }, '<0.2')
        .add(() => morphTo(lang, 1.9), '<')
    })

  return {
    setProgress(fraction) {
      if (opts.reducedMotion || finished) return
      gsap.to(counter, { v: Math.min(fraction, 0.98) * 100, duration: 0.5, ease: 'power2.out', onUpdate: draw })
    },
    finish,
    replay() {
      if (opts.reducedMotion) return
      stopCycle()
      finished = false
      counter.v = 0
      draw()
      gsap.set(preloader, { autoAlpha: 1 })
      preloader.hidden = false
      gsap.set(inner, { autoAlpha: 0 })
      // data is cached by now, so the replay counts on a fixed timeline
      gsap.to(counter, { v: 92, duration: 1.3, ease: 'power1.inOut', onUpdate: draw, onComplete: () => void finish() })
    },
    setLang(l) {
      lang = l
      srTitle.textContent = TITLE[l]
      if (opts.reducedMotion || !finished) {
        if (opts.reducedMotion) showStatic()
        return
      }
      stopCycle()
      if (shown !== l) morphTo(l, 1.2)
      scheduleCycle()
    },
  }
}
