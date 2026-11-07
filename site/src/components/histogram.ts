import * as d3 from 'd3'
// d3's root package is marked side-effect-free, so production builds drop the module that adds
// selection.transition() / .interrupt(); importing it directly keeps it.
import 'd3-transition'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import type { ResultRow, TatoebaData, TatoebaPair } from '../lib/data'
import { findResult, resultValue } from '../lib/data'
import { el } from '../lib/dom'
import { integer, pValue, signed } from '../lib/format'

/**
 * Classifier calibration: the PL − EN sentiment difference of 1,000 Tatoeba
 * translation pairs, as a histogram. Bars are coloured by the sign of the
 * difference (which language's sentence was rated more positively), with a
 * neutral bin around zero: two hues and a grey midpoint.
 */
const BIN = 0.05
const BAR_GAP = 2 // surface gap between touching bars

interface Bin {
  x0: number
  x1: number
  pairs: TatoebaPair[]
}

const diff = (p: TatoebaPair) => p.sentiment_pl - p.sentiment_en

export function mountHistogram(
  root: HTMLElement,
  opts: { data: TatoebaData; results: ResultRow[]; reducedMotion: boolean; wide?: boolean },
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

  // bins centred on zero: (−0.025, 0.025], …
  const maxAbs = Math.ceil((d3.max(pairs, (p) => Math.abs(diff(p))) ?? 1) * 10) / 10
  const edges = d3.range(-maxAbs - BIN / 2, maxAbs + BIN / 2 + 1e-9, BIN)
  const bins: Bin[] = d3
    .bin<TatoebaPair, number>()
    .value(diff)
    .domain([edges[0], edges[edges.length - 1]])
    .thresholds(edges)(pairs)
    .map((b) => ({ x0: b.x0 ?? 0, x1: b.x1 ?? 0, pairs: [...b] }))
  const sign = (b: Bin) => {
    const mid = (b.x0 + b.x1) / 2
    return Math.abs(mid) < BIN / 2 ? 'zero' : mid < 0 ? 'en' : 'pl'
  }

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
  const controls = el('div', { class: 'chart__controls' }, [randomBtn])
  const plot = el('div', { class: 'chart__plot chart__plot--wide' })
  const tooltip = el('div', { class: 'tooltip', 'aria-hidden': 'true' })
  const live = el('p', { class: 'sr-only', 'aria-live': 'polite' })
  const pairCard = el('div', { class: 'pair', 'aria-live': 'polite' })
  const legend = el('div', { class: 'legend' }, [
    el('span', {}, [el('i', { class: 'key key--sq-en' }), 'English sentence rated more positive']),
    el('span', {}, [el('i', { class: 'key key--sq-zero' }), `Within ±${(BIN / 2).toFixed(3).replace(/^0/, '')}`]),
    el('span', {}, [el('i', { class: 'key key--sq-pl' }), 'Polish sentence rated more positive']),
  ])
  const caption = el('p', {
    class: 'caption',
    text:
      `Each pair is one English sentence and its Polish translation from ${opts.data.source}, scored with the same ` +
      'classifier and setting as the answers. Bars are 0.05 wide; click a bar to read a pair from it.',
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
  if (opts.wide) root.classList.add('chart--wide')
  root.replaceChildren(head, controls, plot, el('div', { class: 'chart__side' }, [legend, caption, pairCard, table]), live)

  const svg = d3.select(plot).append('svg').attr('tabindex', 0).attr('role', 'group').attr('aria-roledescription', 'interactive chart')
  svg.attr(
    'aria-label',
    `Histogram of the PL − EN sentiment difference for ${pairs.length} sentence pairs. Arrow keys move between bars; Enter shows a pair from the bar.`,
  )
  const gGrid = svg.append('g').attr('class', 'sc-grid')
  const gAxis = svg.append('g').attr('class', 'sc-axis')
  const gBars = svg.append('g')
  const gRef = svg.append('g')
  const xTitle = svg.append('text').attr('class', 'sc-axis-title').attr('text-anchor', 'middle')
  const yTitle = svg.append('text').attr('class', 'sc-axis-title').attr('text-anchor', 'middle')
  plot.append(tooltip)

  let entered = opts.reducedMotion
  let x = d3.scaleLinear()
  let y = d3.scaleLinear()
  let focus = -1
  const nonEmpty = bins.map((b, i) => (b.pairs.length ? i : -1)).filter((i) => i >= 0)

  const barPath = (b: Bin, h: number) => {
    const x0 = x(b.x0) + BAR_GAP / 2
    const w = Math.max(1, x(b.x1) - x(b.x0) - BAR_GAP)
    const base = y(0)
    const top = base - h
    const r = Math.min(4, w / 2, h) // rounded data end, square at the baseline
    return `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + w - r}Q${x0 + w},${top} ${x0 + w},${top + r}V${base}Z`
  }

  function render(animate: boolean) {
    const width = Math.max(320, plot.clientWidth || 760)
    const height = Math.round(Math.min(380, Math.max(260, width * 0.45)))
    const m = { top: 30, right: 16, bottom: 50, left: 52 }
    x = d3.scaleLinear().domain([edges[0], edges[edges.length - 1]]).range([m.left, width - m.right])
    const maxCount = d3.max(bins, (b) => b.pairs.length) ?? 1
    y = d3.scaleLinear().domain([0, maxCount]).nice().range([height - m.bottom, m.top])
    svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`)

    const yt = y.ticks(5)
    gGrid
      .selectAll<SVGLineElement, number>('line')
      .data(yt)
      .join('line')
      .attr('x1', m.left)
      .attr('x2', width - m.right)
      .attr('y1', (d) => y(d))
      .attr('y2', (d) => y(d))
    gAxis
      .selectAll<SVGTextElement, number>('text.yt')
      .data(yt)
      .join('text')
      .attr('class', 'yt')
      .attr('x', m.left - 8)
      .attr('y', (d) => y(d))
      .attr('dy', '0.32em')
      .attr('text-anchor', 'end')
      .text((d) => integer(d))
    const xt = [-1, -0.5, 0, 0.5, 1].filter((v) => v >= edges[0] && v <= edges[edges.length - 1])
    gAxis
      .selectAll<SVGTextElement, number>('text.xt')
      .data(xt)
      .join('text')
      .attr('class', 'xt')
      .attr('x', (d) => x(d))
      .attr('y', height - m.bottom + 18)
      .attr('text-anchor', 'middle')
      .text((d) => (d === 0 ? '0' : signed(d, 1, true)))
    xTitle
      .attr('x', (m.left + width - m.right) / 2)
      .attr('y', height - 8)
      .text(width < 560 ? 'PL − EN sentiment' : 'Sentiment of the Polish sentence minus the English sentence')
    yTitle.attr('transform', `translate(14,${(m.top + height - m.bottom) / 2}) rotate(-90)`).text('Pairs')

    const median = resultValue(row, 'median_diff')
    gRef
      .selectAll<SVGGElement, { v: number; label: string; dy: number }>('g')
      .data([
        { v: 0, label: '0', dy: 12 },
        { v: median, label: `median ${signed(median)}`, dy: 0 },
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
          .attr('y2', height - m.bottom)
        g.select<SVGTextElement>('text')
          .attr('x', (d) => x(d.v) + (d.v === 0 ? -6 : 6))
          .attr('text-anchor', (d) => (d.v === 0 ? 'end' : 'start'))
          .attr('y', (d) => m.top - 12 + d.dy)
          .text((d) => (d.v === 0 ? '' : d.label))
      })

    const bars = gBars
      .selectAll<SVGPathElement, Bin>('path.hist-bar')
      .data(bins)
      .join('path')
      .attr('class', (b) => `hist-bar hist-bar--${sign(b)}`)
    const target = (b: Bin) => barPath(b, y(0) - y(b.pairs.length))
    if (!entered) bars.attr('d', (b) => barPath(b, 0))
    else if (animate) {
      bars
        .attr('d', (b) => barPath(b, 0))
        .transition()
        .duration(900)
        .delay((_b, i) => Math.abs(i - bins.length / 2) * 25)
        .ease(d3.easeCubicOut)
        .attr('d', target)
    } else bars.interrupt().attr('d', target)
  }

  function showTip(i: number, announce: boolean) {
    const b = bins[i]
    if (!b) return
    focus = i
    gBars.selectAll<SVGPathElement, Bin>('path.hist-bar').classed('is-active', (_d, k) => k === i)
    tooltip.replaceChildren(
      el('div', { class: 'tt__vals' }, [`${integer(b.pairs.length)}`, el('small', { text: b.pairs.length === 1 ? 'pair' : 'pairs' })]),
      el('div', { class: 'tt__meta', text: `PL − EN between ${signed(b.x0)} and ${signed(b.x1)}` }),
    )
    tooltip.style.left = `${(x(b.x0) + x(b.x1)) / 2}px`
    tooltip.style.top = `${y(b.pairs.length) - 6}px`
    tooltip.classList.add('is-on')
    if (announce) live.textContent = `${b.pairs.length} pairs with PL − EN between ${signed(b.x0)} and ${signed(b.x1)}.`
  }
  function hideTip() {
    tooltip.classList.remove('is-on')
    gBars.selectAll('path.hist-bar').classed('is-active', false)
  }

  const binAt = (px: number) => bins.findIndex((b) => px >= x(b.x0) && px < x(b.x1))

  function showPair(p: TatoebaPair) {
    const url = (id: string) => opts.data.sentence_url.replace('{id}', id)
    const side = (lang: 'en' | 'pl') => {
      const text = lang === 'en' ? p.en : p.pl
      const score = lang === 'en' ? p.sentiment_en : p.sentiment_pl
      const label = lang === 'en' ? p.label_en : p.label_pl
      const id = lang === 'en' ? p.eng_id : p.pol_id
      const a = el('a', { href: url(id), target: '_blank', rel: 'noopener', text: `Tatoeba #${id}` })
      return el('div', { class: 'pair__side', lang }, [
        el('span', { class: 'pair__key' }, [el('i', { class: `key key--${lang}` }), lang === 'en' ? 'English' : 'Polish']),
        el('p', { class: 'pair__text', text: text }),
        el('span', { class: 'pair__meta' }, [`${signed(score)} · ${label} · `, a]),
      ])
    }
    pairCard.replaceChildren(
      el('span', { class: 'label', text: `Pair ${p.pair_no} · PL − EN ${signed(diff(p))}` }),
      el('div', { class: 'pair__sides' }, [side('en'), side('pl')]),
    )
  }

  const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]
  randomBtn.addEventListener('click', () => showPair(pick(pairs)))

  svg.on('pointermove', (ev: PointerEvent) => {
    if (!entered) return
    const [px] = d3.pointer(ev)
    const i = binAt(px)
    if (i >= 0 && bins[i].pairs.length) showTip(i, false)
    else hideTip()
  })
  svg.on('pointerleave', hideTip)
  svg.on('click', (ev: PointerEvent) => {
    const [px] = d3.pointer(ev)
    const i = binAt(px)
    if (i >= 0 && bins[i].pairs.length) showPair(pick(bins[i].pairs))
  })
  svg.on('focus', () => {
    if (!entered) {
      entered = true
      render(false)
    }
    showTip(focus >= 0 ? focus : nonEmpty[Math.floor(nonEmpty.length / 2)], true)
  })
  svg.on('blur', hideTip)
  svg.on('keydown', (ev: KeyboardEvent) => {
    const at = Math.max(0, nonEmpty.indexOf(focus))
    if (ev.key === 'ArrowRight') showTip(nonEmpty[Math.min(nonEmpty.length - 1, at + 1)], true)
    else if (ev.key === 'ArrowLeft') showTip(nonEmpty[Math.max(0, at - 1)], true)
    else if (ev.key === 'Enter' || ev.key === ' ') {
      if (focus >= 0) showPair(pick(bins[focus].pairs))
    } else if (ev.key === 'Escape') return hideTip()
    else return
    ev.preventDefault()
  })

  showPair(pairs[0])
  render(false)
  if (!entered) {
    ScrollTrigger.create({
      trigger: plot,
      start: 'top 78%',
      once: true,
      onEnter: () => {
        entered = true
        render(true)
      },
    })
  }
  let frame = 0
  new ResizeObserver(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => render(false))
  }).observe(plot)
}
