import * as d3 from 'd3'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import type { ResultRow, TatoebaData, TatoebaPair } from '../lib/data'
import { findResult, resultValue } from '../lib/data'
import { cssVar, el } from '../lib/dom'
import { integer, pValue, signed } from '../lib/format'

/**
 * Classifier calibration as a unit histogram: every Tatoeba translation pair
 * is one dot, stacked in its 0.05-wide bin of the PL − EN sentiment
 * difference. All bins hold the same number of dots per row, so stack height
 * stays proportional to the count. Colour follows the sign of the difference
 * (which language's sentence was rated more positively), with a neutral bin
 * around zero: two hues and a grey midpoint.
 *
 * On first view the dots fall into place (bottom rows first); with reduced
 * motion they are drawn in place. Hover a dot for its sentence pair.
 */
const BIN = 0.05
type Sign = 'en' | 'pl' | 'zero'

interface Bin {
  x0: number
  x1: number
  pairs: TatoebaPair[]
  sign: Sign
}

interface Dot {
  pair: TatoebaPair
  bin: number
  k: number // position inside its bin
  tx: number
  ty: number
  sx: number
  sy: number
  delay: number
}

const diff = (p: TatoebaPair) => p.sentiment_pl - p.sentiment_en
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** Deterministic random numbers, so the fall looks the same on every visit. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

export function mountHistogram(
  root: HTMLElement,
  opts: { data: TatoebaData; results: ResultRow[]; reducedMotion: boolean },
): void {
  const { pairs } = opts.data
  const row = findResult(opts.results, {
    run: 'calibration',
    section: 'classifier calibration (Tatoeba)',
    measure: 'polarity, 512-token truncation',
    subset: 'all',
  })
  if (row.n !== pairs.length) throw new Error(`tatoeba.json has ${pairs.length} pairs, results.json says ${row.n}`)
  const sameLabel = pairs.filter((p) => p.label_en === p.label_pl).length
  const noted = row.notes?.match(/same top label in (\d+)\/(\d+) pairs/)
  if (!noted || Number(noted[1]) !== sameLabel) {
    throw new Error(`same-label count ${sameLabel} does not match results.json notes (${row.notes})`)
  }

  // bins centred on zero: (−0.025, 0.025], …; inside a bin, dots ordered by difference
  const maxAbs = Math.ceil((d3.max(pairs, (p) => Math.abs(diff(p))) ?? 1) * 10) / 10
  const edges = d3.range(-maxAbs - BIN / 2, maxAbs + BIN / 2 + 1e-9, BIN)
  const bins: Bin[] = d3
    .bin<TatoebaPair, number>()
    .value(diff)
    .domain([edges[0], edges[edges.length - 1]])
    .thresholds(edges)(pairs)
    .map((b) => {
      const x0 = b.x0 ?? 0
      const x1 = b.x1 ?? 0
      const mid = (x0 + x1) / 2
      const sign: Sign = Math.abs(mid) < BIN / 2 ? 'zero' : mid < 0 ? 'en' : 'pl'
      return { x0, x1, sign, pairs: [...b].sort((p, q) => diff(p) - diff(q) || p.pair_no - q.pair_no) }
    })
  const maxCount = d3.max(bins, (b) => b.pairs.length) ?? 1
  const nonEmpty = bins.map((b, i) => (b.pairs.length ? i : -1)).filter((i) => i >= 0)

  // ---- DOM ----
  const head = el('div', { class: 'chart__head' }, [
    el('h4', { class: 'chart__title' }, [el('span', { text: 'Sentiment difference within 1,000 translation pairs (PL − EN)' })]),
    el('p', {
      class: 'chart__sub',
      text: [
        `n = ${integer(row.n)}`,
        `median PL − EN ${signed(resultValue(row, 'median_diff'))}`,
        `Wilcoxon p = ${pValue(resultValue(row, 'p'))}`,
        `r = ${signed(resultValue(row, 'rank_biserial'), 2)}`,
        `same top label in ${integer(sameLabel)} of ${integer(pairs.length)} pairs`,
      ].join(' · '),
    }),
  ])
  const randomBtn = el('button', { class: 'chip', type: 'button', text: 'Show a random pair' })
  const dropBtn = el('button', { class: 'chip', type: 'button', text: 'Drop the pairs again' })
  const controls = el('div', { class: 'chart__controls' }, opts.reducedMotion ? [randomBtn] : [randomBtn, dropBtn])
  const plot = el('div', { class: 'chart__plot chart__plot--wide hist' })
  const canvas = el('canvas', { class: 'hist__canvas', 'aria-hidden': 'true' })
  const tooltip = el('div', { class: 'tooltip', 'aria-hidden': 'true' })
  const live = el('p', { class: 'sr-only', 'aria-live': 'polite' })
  const pairCard = el('div', { class: 'pair', 'aria-live': 'polite' })
  const legend = el('div', { class: 'legend' }, [
    el('span', {}, [el('i', { class: 'key key--en' }), 'English sentence rated more positive']),
    el('span', {}, [el('i', { class: 'key key--zero' }), `Within ±${(BIN / 2).toFixed(3).replace(/^0/, '')}`]),
    el('span', {}, [el('i', { class: 'key key--pl' }), 'Polish sentence rated more positive']),
  ])
  const caption = el('p', {
    class: 'caption',
    text:
      `Each dot is one pair: an English sentence and its Polish translation from ${opts.data.source}, scored with the ` +
      'same classifier and setting as the answers. Bins are 0.05 wide; hover a dot to read its pair, click to keep it below.',
  })
  const tbody = el('tbody')
  const table = el('details', { class: 'datatable' }, [
    el('summary', { text: 'Show data table' }),
    el('div', { class: 'tablewrap' }, [
      el('table', {}, [
        el('caption', { text: 'Number of pairs per bin of the PL − EN difference' }),
        el('thead', {}, [
          el('tr', {}, [el('th', { scope: 'col', text: 'PL − EN from' }), el('th', { scope: 'col', text: 'to' }), el('th', { scope: 'col', class: 'num', text: 'Pairs' })]),
        ]),
        tbody,
      ]),
    ]),
  ])
  tbody.replaceChildren(
    ...bins
      .filter((b) => b.pairs.length)
      .map((b) =>
        el('tr', {}, [
          el('td', { class: 'num', text: signed(b.x0) }),
          el('td', { class: 'num', text: signed(b.x1) }),
          el('td', { class: 'num', text: integer(b.pairs.length) }),
        ]),
      ),
  )
  root.classList.add('chart')
  plot.append(canvas)
  root.replaceChildren(head, controls, plot, el('div', { class: 'chart__side chart__side--row' }, [legend, caption, pairCard, table]), live)

  const svg = d3.select(plot).append('svg').attr('class', 'hist__overlay').attr('tabindex', 0).attr('role', 'group').attr('aria-roledescription', 'interactive chart')
  svg.attr(
    'aria-label',
    `Unit histogram of the PL − EN sentiment difference for ${pairs.length} sentence pairs, one dot per pair. ` +
      'Left and right arrows move between bins, up and down between the pairs of a bin, Enter keeps the pair below the chart.',
  )
  const gAxis = svg.append('g').attr('class', 'sc-axis')
  const gRef = svg.append('g')
  const xTitle = svg.append('text').attr('class', 'sc-axis-title').attr('text-anchor', 'middle')
  const yTitle = svg.append('text').attr('class', 'sc-axis-title').attr('text-anchor', 'middle')
  plot.append(tooltip)

  // ---- layout ----
  const ctx = canvas.getContext('2d')
  let width = 0
  let height = 0
  let x = d3.scaleLinear()
  const m = { top: 30, right: 16, bottom: 50, left: 52 }
  let pitch = 6
  let perRow = 3
  let radius = 2.4
  let baseline = 0
  let dots: Dot[] = []
  const byBin: Dot[][] = bins.map(() => [])
  let colours: Record<Sign | 'line' | 'text' | 'surface', string> = { en: '', pl: '', zero: '', line: '', text: '', surface: '' }
  let progress = opts.reducedMotion ? Infinity : 0 // ms since the drop started
  let dropping = false
  let focus: Dot | null = null

  const yCount = (c: number) => baseline - (c / perRow) * pitch

  function layout() {
    width = Math.max(320, plot.clientWidth || 760)
    height = Math.round(Math.min(400, Math.max(280, width * 0.46)))
    x = d3.scaleLinear().domain([edges[0], edges[edges.length - 1]]).range([m.left, width - m.right])
    baseline = height - m.bottom
    const plotH = baseline - m.top - 8
    const binW = x(edges[1]) - x(edges[0])
    // largest dot pitch at which the tallest bin still fits (on a phone the dots get tiny)
    pitch = 1
    for (let p = 9; p >= 1; p -= 0.25) {
      const per = Math.max(1, Math.floor((binW - 0.5) / p))
      if (Math.ceil(maxCount / per) * p <= plotH) {
        pitch = p
        break
      }
    }
    perRow = Math.max(1, Math.floor((binW - 0.5) / pitch))
    radius = Math.max(0.55, pitch * 0.4)

    const rand = mulberry32(2026)
    dots = []
    byBin.forEach((list) => (list.length = 0))
    const centre = bins.findIndex((b) => b.sign === 'zero')
    bins.forEach((b, i) => {
      const left = x(b.x0) + (binW - perRow * pitch) / 2
      b.pairs.forEach((pair, k) => {
        const rowIdx = Math.floor(k / perRow)
        const col = k % perRow
        const tx = left + col * pitch + pitch / 2
        const ty = baseline - rowIdx * pitch - pitch / 2
        const d: Dot = {
          pair,
          bin: i,
          k,
          tx,
          ty,
          sx: tx + (rand() - 0.5) * 140,
          sy: -20 - rand() * 360,
          delay: rowIdx * 28 + rand() * 650 + Math.abs(i - centre) * 6,
        }
        dots.push(d)
        byBin[i].push(d)
      })
    })
    colours = {
      en: cssVar('--en'),
      pl: cssVar('--pl'),
      zero: cssVar('--text-3'),
      line: cssVar('--line'),
      text: cssVar('--text'),
      surface: cssVar('--surface-2'),
    }

    // canvas at device resolution
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)

    // SVG overlay: tick labels, titles, zero and median lines
    svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`)
    const yt = d3.ticks(0, maxCount, 4).filter((c) => c <= maxCount && yCount(c) >= m.top - 4)
    gAxis
      .selectAll<SVGTextElement, number>('text.yt')
      .data(yt)
      .join('text')
      .attr('class', 'yt')
      .attr('x', m.left - 8)
      .attr('y', (c) => yCount(c))
      .attr('dy', '0.32em')
      .attr('text-anchor', 'end')
      .text((c) => integer(c))
    const xt = [-1, -0.5, 0, 0.5, 1].filter((v) => v >= edges[0] && v <= edges[edges.length - 1])
    gAxis
      .selectAll<SVGTextElement, number>('text.xt')
      .data(xt)
      .join('text')
      .attr('class', 'xt')
      .attr('x', (d) => x(d))
      .attr('y', baseline + 18)
      .attr('text-anchor', 'middle')
      .text((d) => (d === 0 ? '0' : signed(d, 1, true)))
    xTitle
      .attr('x', (m.left + width - m.right) / 2)
      .attr('y', height - 8)
      .text(width < 560 ? 'PL − EN sentiment' : 'Sentiment of the Polish sentence minus the English sentence')
    yTitle.attr('transform', `translate(14,${(m.top + baseline) / 2}) rotate(-90)`).text('Pairs')
    const median = resultValue(row, 'median_diff')
    gRef
      .selectAll<SVGGElement, { v: number; label: string }>('g')
      .data([
        { v: 0, label: '' },
        { v: median, label: `median ${signed(median)}` },
      ])
      .join((enter) => {
        const g = enter.append('g')
        g.append('line').attr('class', 'sc-diag')
        g.append('text').attr('class', 'sc-note')
        return g
      })
      .call((g) => {
        g.select('line')
          .attr('x1', (d) => x(d.v))
          .attr('x2', (d) => x(d.v))
          .attr('y1', m.top - 8)
          .attr('y2', baseline)
        g.select<SVGTextElement>('text')
          .attr('x', (d) => x(d.v) + 6)
          .attr('y', m.top - 12)
          .text((d) => d.label)
      })
    yTicks = yt
  }
  let yTicks: number[] = []

  // ---- drawing ----
  function dotPos(d: Dot): [number, number] {
    const t = (progress - d.delay) / 900
    if (t >= 1) return [d.tx, d.ty]
    if (t <= 0) return [d.sx, d.sy]
    const x0 = d.sx + (d.tx - d.sx) * easeInOutCubic(t)
    // fall with gravity, then one small bounce
    if (t < 0.78) {
      const f = t / 0.78
      return [x0, d.sy + (d.ty - d.sy) * f * f]
    }
    const b = (t - 0.78) / 0.22
    const h = Math.min(7, 0.025 * (d.ty - d.sy))
    return [x0, d.ty - h * Math.sin(Math.PI * b)]
  }

  function draw() {
    if (!ctx) return
    ctx.clearRect(0, 0, width, height)
    ctx.strokeStyle = colours.line
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const c of yTicks) {
      const yy = Math.round(yCount(c)) + 0.5
      ctx.moveTo(m.left, yy)
      ctx.lineTo(width - m.right, yy)
    }
    ctx.stroke()
    for (const sign of ['zero', 'en', 'pl'] as const) {
      ctx.fillStyle = colours[sign]
      ctx.beginPath()
      for (const d of dots) {
        if (bins[d.bin].sign !== sign) continue
        const [px, py] = dotPos(d)
        if (py < -radius) continue
        ctx.moveTo(px + radius, py)
        ctx.arc(px, py, radius, 0, Math.PI * 2)
      }
      ctx.fill()
    }
    if (focus) {
      const [px, py] = dotPos(focus)
      ctx.strokeStyle = colours.text
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(px, py, radius + 3, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  let raf = 0
  let started = 0
  function drop() {
    cancelAnimationFrame(raf)
    dropping = true
    started = performance.now()
    progress = 0
    const lastLanding = (d3.max(dots, (d) => d.delay) ?? 0) + 900
    const step = (now: number) => {
      progress = now - started
      draw()
      if (progress < lastLanding) raf = requestAnimationFrame(step)
      else {
        progress = Infinity
        dropping = false
        draw()
      }
    }
    raf = requestAnimationFrame(step)
  }

  // ---- hover, click, keyboard ----
  function dotAt(px: number, py: number): Dot | null {
    const i = bins.findIndex((b) => px >= x(b.x0) && px < x(b.x1))
    if (i < 0) return null
    const list = byBin[i]
    if (!list.length) return null
    const binW = x(bins[i].x1) - x(bins[i].x0)
    const left = x(bins[i].x0) + (binW - perRow * pitch) / 2
    const col = Math.min(perRow - 1, Math.max(0, Math.floor((px - left) / pitch)))
    const rowIdx = Math.floor((baseline - py) / pitch)
    if (rowIdx < 0) return null
    const k = rowIdx * perRow + col
    if (k < list.length) return list[k]
    // above the stack: snap to its top dot, so a short bin is still easy to hit
    const top = list[list.length - 1]
    return baseline - py < (Math.ceil(list.length / perRow) + 2) * pitch ? top : null
  }

  function show(d: Dot, announce: boolean) {
    focus = d
    if (!dropping) draw()
    const p = d.pair
    tooltip.replaceChildren(
      el('div', { class: 'tt__vals' }, [
        el('span', {}, [signed(p.sentiment_pl), el('small', { text: 'PL' })]),
        el('span', {}, [signed(p.sentiment_en), el('small', { text: 'EN' })]),
      ]),
      el('div', { class: 'tt__label', lang: 'pl', text: clip(p.pl, 80) }),
      el('div', { class: 'tt__meta', lang: 'en', text: clip(p.en, 80) }),
      el('div', { class: 'tt__meta', text: `PL − EN ${signed(diff(p))} · pair ${p.pair_no}` }),
    )
    const [px, py] = dotPos(d)
    tooltip.style.left = `${Math.min(Math.max(px, 130), width - 130)}px`
    tooltip.style.top = `${py - 8}px`
    tooltip.style.transform = py < 130 ? 'translate(-50%, 16px)' : ''
    tooltip.classList.add('is-on')
    if (announce) {
      live.textContent = `Pair ${p.pair_no}: Polish ${signed(p.sentiment_pl)}, English ${signed(p.sentiment_en)}. ${p.pl} / ${p.en}`
    }
  }

  function hide() {
    tooltip.classList.remove('is-on')
    focus = null
    if (!dropping) draw()
  }

  function keep(p: TatoebaPair) {
    const url = (id: string) => opts.data.sentence_url.replace('{id}', id)
    const side = (lang: 'en' | 'pl') => {
      const text = lang === 'en' ? p.en : p.pl
      const score = lang === 'en' ? p.sentiment_en : p.sentiment_pl
      const label = lang === 'en' ? p.label_en : p.label_pl
      const id = lang === 'en' ? p.eng_id : p.pol_id
      return el('div', { class: 'pair__side', lang }, [
        el('span', { class: 'pair__key' }, [el('i', { class: `key key--${lang}` }), lang === 'en' ? 'English' : 'Polish']),
        el('p', { class: 'pair__text', text }),
        el('span', { class: 'pair__meta' }, [
          `${signed(score)} · ${label} · `,
          el('a', { href: url(id), target: '_blank', rel: 'noopener', text: `Tatoeba #${id}` }),
        ]),
      ])
    }
    pairCard.replaceChildren(
      el('span', { class: 'label', text: `Pair ${p.pair_no} · PL − EN ${signed(diff(p))}` }),
      el('div', { class: 'pair__sides' }, [side('en'), side('pl')]),
    )
  }

  const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]
  randomBtn.addEventListener('click', () => {
    const d = pick(dots)
    keep(d.pair)
    show(d, true)
  })
  dropBtn.addEventListener('click', () => {
    hide()
    drop()
  })

  svg.on('pointermove', (ev: PointerEvent) => {
    if (dropping) return
    const [px, py] = d3.pointer(ev)
    const d = dotAt(px, py)
    if (d) show(d, false)
    else hide()
  })
  svg.on('pointerleave', hide)
  svg.on('click', (ev: PointerEvent) => {
    const [px, py] = d3.pointer(ev)
    const d = dotAt(px, py)
    if (d) keep(d.pair)
  })
  svg.on('focus', () => {
    if (progress !== Infinity && !dropping) {
      progress = Infinity
      draw()
    }
    show(focus ?? byBin[nonEmpty[Math.floor(nonEmpty.length / 2)]][0], true)
  })
  svg.on('blur', hide)
  svg.on('keydown', (ev: KeyboardEvent) => {
    const cur = focus ?? byBin[nonEmpty[0]][0]
    const binPos = nonEmpty.indexOf(cur.bin)
    let next: Dot | null = null
    if (ev.key === 'ArrowRight') next = byBin[nonEmpty[Math.min(nonEmpty.length - 1, binPos + 1)]][0]
    else if (ev.key === 'ArrowLeft') next = byBin[nonEmpty[Math.max(0, binPos - 1)]][0]
    else if (ev.key === 'ArrowUp') next = byBin[cur.bin][Math.min(byBin[cur.bin].length - 1, cur.k + 1)]
    else if (ev.key === 'ArrowDown') next = byBin[cur.bin][Math.max(0, cur.k - 1)]
    else if (ev.key === 'Enter' || ev.key === ' ') {
      keep(cur.pair)
      ev.preventDefault()
      return
    } else if (ev.key === 'Escape') {
      hide()
      return
    } else return
    ev.preventDefault()
    if (next) show(next, true)
  })

  keep(pairs[0])
  layout()
  draw()
  if (!opts.reducedMotion) {
    ScrollTrigger.create({ trigger: plot, start: 'top 75%', once: true, onEnter: () => drop() })
  }
  let frame = 0
  new ResizeObserver(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      layout()
      draw()
    })
  }).observe(plot)
}
