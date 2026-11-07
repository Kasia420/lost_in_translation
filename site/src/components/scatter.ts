import * as d3 from 'd3'
// d3's root package is marked side-effect-free, so production builds drop the module that adds
// selection.transition() / .interrupt(); importing it directly keeps it.
import 'd3-transition'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import type { DomainId, Meta, ResultRow, Topic } from '../lib/data'
import { findResult, resultValue } from '../lib/data'
import { pValue, signed, tick } from '../lib/format'
import { el } from '../lib/dom'

export type ScatterView = 'v2' | 'v1' | 'wiki'

interface Datum {
  id: string
  topic: string
  domain: DomainId
  domainLabel: string
  en: number
  pl: number
}

const PRIMARY = 'polarity, 512-token truncation (primary)'
const GAP = 'PL - EN polarity, 512-token truncation (primary)'
const TICKS = [-1, -0.5, 0, 0.5, 1]
const SYMBOL_AREA = 100 // px², about 11 px across
const HIT_RADIUS = 28 // pointer only has to be this close (nearest-point search)
const DOMAIN_ORDER: DomainId[] = ['contested_history', 'literature', 'social_norms']
export const DOMAIN_SYMBOL: Record<DomainId, d3.SymbolType> = {
  contested_history: d3.symbolCircle,
  literature: d3.symbolSquare,
  social_norms: d3.symbolTriangle,
}

const VIEW: Record<
  ScatterView,
  { button: string; name: string; x: string; y: string; above: [string, string]; below: [string, string]; exploratory: boolean }
> = {
  v2: {
    button: 'Answers v2',
    name: 'Answers, v2',
    x: 'Sentiment of the English answer',
    y: 'Sentiment of the Polish answer',
    above: ['Above the line:', 'Polish answer more positive'],
    below: ['Below the line:', 'English answer more positive'],
    exploratory: true,
  },
  v1: {
    button: 'Answers v1',
    name: 'Answers, v1 (course submission)',
    x: 'Sentiment of the English answer',
    y: 'Sentiment of the Polish answer',
    above: ['Above the line:', 'Polish answer more positive'],
    below: ['Below the line:', 'English answer more positive'],
    exploratory: false,
  },
  wiki: {
    button: 'Wikipedia leads',
    name: 'Wikipedia lead sections (same data in both runs)',
    x: 'Sentiment of the English Wikipedia lead',
    y: 'Sentiment of the Polish Wikipedia lead',
    above: ['Above the line:', 'Polish lead more positive'],
    below: ['Below the line:', 'English lead more positive'],
    exploratory: true,
  },
}

export function symbolPath(domain: DomainId, area = SYMBOL_AREA): string {
  return d3.symbol(DOMAIN_SYMBOL[domain], area)() ?? ''
}

export function symbolIcon(domain: DomainId): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '-7 -7 14 14')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', symbolPath(domain, 70))
  svg.append(path)
  return svg
}

function rowsFor(view: ScatterView, topics: Topic[]): Datum[] {
  const out: Datum[] = []
  for (const t of topics) {
    const base = { id: t.id, topic: t.topic, domain: t.domain, domainLabel: t.domain_label }
    if (view === 'wiki') {
      if (!t.wikipedia) continue // s06 has no Wikipedia baseline
      out.push({ ...base, en: t.wikipedia.en.sentiment, pl: t.wikipedia.pl.sentiment })
    } else {
      const a = t.runs[view].answers
      out.push({ ...base, en: a.en.sentiment, pl: a.pl.sentiment })
    }
  }
  return out
}

function testFor(view: ScatterView, results: ResultRow[]): ResultRow {
  return view === 'wiki'
    ? findResult(results, { run: 'v1', section: 'Wikipedia sentiment', measure: PRIMARY, subset: 'all' })
    : findResult(results, { run: view, section: 'answer sentiment', measure: PRIMARY, subset: 'all' })
}

function describeTest(row: ResultRow): string {
  return [
    `n = ${row.n}`,
    `median PL − EN ${signed(resultValue(row, 'median_diff'))}`,
    `Wilcoxon p = ${pValue(resultValue(row, 'p'))}`,
    `r = ${signed(resultValue(row, 'rank_biserial'), 2)}`,
  ].join(' · ')
}

export interface ScatterOptions {
  topics: Topic[]
  results: ResultRow[]
  meta: Meta
  views: ScatterView[]
  initial: ScatterView
  showGapTest?: boolean
  /** plot on the left, legend/notes/table on the right on wide screens */
  wide?: boolean
  reducedMotion: boolean
}

export function mountScatter(root: HTMLElement, opts: ScatterOptions): { setView(v: ScatterView): void } {
  let view: ScatterView = opts.initial
  let highlight: DomainId | 'all' = 'all'
  let entered = opts.reducedMotion
  let data: Datum[] = []
  let order: number[] = []
  let focusIdx = -1
  let x = d3.scaleLinear()
  let y = d3.scaleLinear()
  let delaunay: d3.Delaunay<Datum> | null = null
  let size = 0

  // ---- DOM ----
  const titleText = el('span')
  const exploratory = el('span', { class: 'tag', text: 'exploratory' })
  const title = el('h4', { class: 'chart__title' }, [titleText, exploratory])
  const sub = el('p', { class: 'chart__sub' })
  const head = el('div', { class: 'chart__head' }, [title, sub])
  if (opts.showGapTest) {
    for (const run of ['v2', 'v1'] as const) {
      const g = findResult(opts.results, { run, section: 'gap: answers vs Wikipedia', measure: GAP, subset: 'all' })
      head.append(
        el('p', {
          class: 'chart__sub',
          text:
            `Gap test ${run}: answer gap ${signed(resultValue(g, 'median_A'))} vs Wikipedia gap ` +
            `${signed(resultValue(g, 'median_B'))} (medians, n = ${g.n}) · p = ${pValue(resultValue(g, 'p'))} · ` +
            `r = ${signed(resultValue(g, 'rank_biserial'), 2)}`,
        }),
      )
    }
  }

  const viewSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Data shown' })
  const viewButtons = new Map<ScatterView, HTMLButtonElement>()
  for (const v of opts.views) {
    const b = el('button', { type: 'button', text: VIEW[v].button })
    b.addEventListener('click', () => setView(v))
    viewButtons.set(v, b)
    viewSeg.append(b)
  }

  const chips = new Map<DomainId | 'all', HTMLButtonElement>()
  const chipRow = el('div', { class: 'chart__controls', role: 'group', 'aria-label': 'Highlight a domain' })
  const allChip = el('button', { class: 'chip', type: 'button', text: 'All domains' })
  allChip.addEventListener('click', () => setHighlight('all'))
  chips.set('all', allChip)
  chipRow.append(...(opts.views.length > 1 ? [viewSeg] : []), allChip)
  const domainLabel = new Map(opts.meta.domains.map((d) => [d.id, d.label]))
  for (const d of DOMAIN_ORDER) {
    const c = el('button', { class: 'chip', type: 'button' }, [symbolIcon(d), domainLabel.get(d) ?? d])
    c.addEventListener('click', () => setHighlight(highlight === d ? 'all' : d))
    chips.set(d, c)
    chipRow.append(c)
  }

  const plot = el('div', { class: 'chart__plot' })
  const tooltip = el('div', { class: 'tooltip', 'aria-hidden': 'true' })
  const live = el('p', { class: 'sr-only', 'aria-live': 'polite' })
  const legend = el(
    'div',
    { class: 'legend', 'aria-label': 'Legend' },
    DOMAIN_ORDER.map((d) => el('span', {}, [symbolIcon(d), domainLabel.get(d) ?? d])),
  )
  const caption = el('p', {
    class: 'caption',
    text:
      `Sentiment polarity = ${opts.meta.models.sentiment_polarity.replace(' - ', ' − ')}. ` +
      `Classifier: ${opts.meta.models.sentiment}. Tests: ${opts.meta.statistics.replace(' - ', ' − ')}. ` +
      `The v2 and Wikipedia analyses are exploratory (no correction for multiple comparisons).`,
  })
  const tbody = el('tbody')
  const tableCaption = el('caption')
  const table = el('details', { class: 'datatable' }, [
    el('summary', { text: 'Show data table' }),
    el('div', { class: 'tablewrap' }, [
      el('table', {}, [
        tableCaption,
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Topic' }),
            el('th', { scope: 'col', text: 'Domain' }),
            el('th', { scope: 'col', class: 'num', text: 'EN' }),
            el('th', { scope: 'col', class: 'num', text: 'PL' }),
            el('th', { scope: 'col', class: 'num', text: 'PL − EN' }),
          ]),
        ]),
        tbody,
      ]),
    ]),
  ])
  root.classList.add('chart')
  if (opts.wide) root.classList.add('chart--wide')
  root.replaceChildren(head, chipRow, plot, el('div', { class: 'chart__side' }, [legend, caption, table]), live)

  // ---- SVG skeleton ----
  const svg = d3
    .select(plot)
    .append('svg')
    .attr('tabindex', 0)
    .attr('role', 'group')
    .attr('aria-roledescription', 'interactive chart')
  const gGrid = svg.append('g').attr('class', 'sc-grid')
  const gAxes = svg.append('g').attr('class', 'sc-axis')
  const xTitle = svg.append('text').attr('class', 'sc-axis-title').attr('text-anchor', 'middle')
  const yTitle = svg.append('text').attr('class', 'sc-axis-title').attr('text-anchor', 'middle')
  const diag = svg.append('line').attr('class', 'sc-diag')
  const diagLabel = svg.append('text').attr('class', 'sc-note').attr('text-anchor', 'end').text('EN = PL')
  const noteAbove = svg.append('text').attr('class', 'sc-note').attr('text-anchor', 'start')
  const noteBelow = svg.append('text').attr('class', 'sc-note').attr('text-anchor', 'end')
  const gPoints = svg.append('g')
  const ring = svg.append('circle').attr('class', 'sc-focus').attr('r', 11).style('display', 'none')
  plot.append(tooltip)

  const finalPos = (d: Datum) => `translate(${x(d.en)},${y(d.pl)})`
  const startPos = (d: Datum) => {
    const mid = (d.en + d.pl) / 2
    return `translate(${x(mid)},${y(mid)})`
  }

  function render(animate: boolean) {
    size = Math.max(300, Math.min(plot.clientWidth || 640, 640))
    const m = { top: 20, right: 20, bottom: 54, left: 62 }
    x = d3.scaleLinear().domain([-1, 1]).range([m.left, size - m.right])
    y = d3.scaleLinear().domain([-1, 1]).range([size - m.bottom, m.top])
    svg.attr('width', size).attr('height', size).attr('viewBox', `0 0 ${size} ${size}`)
    svg.attr(
      'aria-label',
      `Scatter plot, ${VIEW[view].name}: each mark is one topic, English sentiment across, Polish sentiment up. ` +
        'Use the arrow keys to step through topics.',
    )

    gGrid
      .selectAll<SVGLineElement, number>('line.v')
      .data(TICKS)
      .join('line')
      .attr('class', 'v')
      .attr('x1', (d) => x(d))
      .attr('x2', (d) => x(d))
      .attr('y1', m.top)
      .attr('y2', size - m.bottom)
    gGrid
      .selectAll<SVGLineElement, number>('line.h')
      .data(TICKS)
      .join('line')
      .attr('class', 'h')
      .attr('y1', (d) => y(d))
      .attr('y2', (d) => y(d))
      .attr('x1', m.left)
      .attr('x2', size - m.right)
    gAxes
      .selectAll<SVGTextElement, number>('text.xt')
      .data(TICKS)
      .join('text')
      .attr('class', 'xt')
      .attr('x', (d) => x(d))
      .attr('y', size - m.bottom + 18)
      .attr('text-anchor', 'middle')
      .text((d) => tick(d))
    gAxes
      .selectAll<SVGTextElement, number>('text.yt')
      .data(TICKS)
      .join('text')
      .attr('class', 'yt')
      .attr('x', m.left - 10)
      .attr('y', (d) => y(d))
      .attr('dy', '0.32em')
      .attr('text-anchor', 'end')
      .text((d) => tick(d))
    xTitle.attr('x', (m.left + size - m.right) / 2).attr('y', size - 12).text(VIEW[view].x)
    yTitle
      .attr('transform', `translate(16,${(m.top + size - m.bottom) / 2}) rotate(-90)`)
      .text(VIEW[view].y)
    diag.attr('x1', x(-1)).attr('y1', y(-1)).attr('x2', x(1)).attr('y2', y(1))
    // label runs along the diagonal, just below it (clear of the upper-left note)
    const angle = (Math.atan2(y(1) - y(-1), x(1) - x(-1)) * 180) / Math.PI
    diagLabel
      .attr('text-anchor', 'middle')
      .attr('transform', `translate(${x(0.78)},${y(0.78)}) rotate(${angle})`)
      .attr('x', 0)
      .attr('y', 14)
    const twoLines = (
      sel: d3.Selection<SVGTextElement, unknown, null, undefined>,
      parts: [string, string],
      x0: number,
      y0: number,
    ) =>
      sel
        .selectAll<SVGTSpanElement, string>('tspan')
        .data(parts)
        .join('tspan')
        .attr('x', x0)
        .attr('y', (_d, i) => y0 + i * 14)
        .text((d) => d)
    twoLines(noteAbove, VIEW[view].above, x(-0.96), y(0.9))
    twoLines(noteBelow, VIEW[view].below, x(0.96), y(-0.86) - 14)

    data = rowsFor(view, opts.topics)
    order = d3.range(data.length).sort((a, b) => data[a].en - data[b].en)
    delaunay = d3.Delaunay.from(
      data,
      (d) => x(d.en),
      (d) => y(d.pl),
    )

    const sel = gPoints.selectAll<SVGPathElement, Datum>('path.sc-point').data(data, (d) => d.id)
    sel
      .exit()
      .interrupt()
      .transition()
      .duration(animate ? 300 : 0)
      .attr('opacity', 0)
      .remove()
    const enter = sel
      .enter()
      .append('path')
      .attr('class', 'sc-point')
      .attr('d', (d) => symbolPath(d.domain))
      .attr('transform', (d) => startPos(d))
      .attr('opacity', 0)
    const all = enter.merge(sel)
    all.classed('is-dim', (d) => highlight !== 'all' && d.domain !== highlight)

    if (!entered) {
      all.interrupt().attr('transform', (d) => startPos(d)).attr('opacity', 0)
    } else if (animate) {
      all
        .interrupt()
        .transition()
        .duration(1000)
        .delay((_d, i) => i * 18)
        .ease(d3.easeCubicOut)
        .attr('transform', (d) => finalPos(d))
        .attr('opacity', 1)
    } else {
      all.interrupt().attr('transform', (d) => finalPos(d)).attr('opacity', 1)
    }
    hide()
  }

  function show(i: number, announce: boolean) {
    const d = data[i]
    if (!d) return
    focusIdx = i
    const cx = x(d.en)
    const cy = y(d.pl)
    ring.attr('cx', cx).attr('cy', cy).style('display', null)

    const vals = el('div', { class: 'tt__vals' }, [
      el('span', {}, [signed(d.pl), el('small', { text: view === 'wiki' ? 'PL lead' : 'PL' })]),
      el('span', {}, [signed(d.en), el('small', { text: view === 'wiki' ? 'EN lead' : 'EN' })]),
    ])
    tooltip.replaceChildren(
      vals,
      el('div', { class: 'tt__label', text: d.topic }),
      el('div', { class: 'tt__meta', text: `${d.domainLabel} · PL − EN ${signed(d.pl - d.en)}` }),
    )
    const left = Math.min(Math.max(cx, 110), size - 110)
    tooltip.style.left = `${left}px`
    tooltip.style.top = `${cy}px`
    tooltip.style.transform = cy < 110 ? 'translate(-50%, 18px)' : ''
    tooltip.classList.add('is-on')
    if (announce) {
      live.textContent = `${d.topic}, ${d.domainLabel}: Polish ${signed(d.pl)}, English ${signed(d.en)}.`
    }
  }

  function hide() {
    ring.style('display', 'none')
    tooltip.classList.remove('is-on')
  }

  svg.on('pointermove', (ev: PointerEvent) => {
    if (!entered || !delaunay) return
    const [px, py] = d3.pointer(ev)
    const i = delaunay.find(px, py)
    const d = data[i]
    if (d && Math.hypot(x(d.en) - px, y(d.pl) - py) <= HIT_RADIUS) show(i, false)
    else hide()
  })
  svg.on('pointerleave', hide)
  svg.on('focus', () => {
    if (!entered) {
      entered = true
      render(false)
    }
    show(focusIdx >= 0 ? focusIdx : order[0], true)
  })
  svg.on('blur', hide)
  svg.on('keydown', (ev: KeyboardEvent) => {
    if (!order.length) return
    const pos = Math.max(0, order.indexOf(focusIdx))
    let nextPos = -1
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') nextPos = (pos + 1) % order.length
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') nextPos = (pos - 1 + order.length) % order.length
    else if (ev.key === 'Home') nextPos = 0
    else if (ev.key === 'End') nextPos = order.length - 1
    else if (ev.key === 'Escape') {
      hide()
      return
    } else return
    ev.preventDefault()
    show(order[nextPos], true)
  })

  function fillTable() {
    tableCaption.textContent = `${VIEW[view].name}: sentiment polarity per topic`
    tbody.replaceChildren(
      ...data.map((d) =>
        el('tr', {}, [
          el('td', { text: d.topic }),
          el('td', { text: d.domainLabel }),
          el('td', { class: 'num', text: signed(d.en) }),
          el('td', { class: 'num', text: signed(d.pl) }),
          el('td', { class: 'num', text: signed(d.pl - d.en) }),
        ]),
      ),
    )
  }

  function setHighlight(h: DomainId | 'all') {
    highlight = h
    for (const [k, b] of chips) b.setAttribute('aria-pressed', String(k === h))
    gPoints.selectAll<SVGPathElement, Datum>('path.sc-point').classed('is-dim', (d) => h !== 'all' && d.domain !== h)
  }

  function setView(v: ScatterView) {
    view = v
    for (const [k, b] of viewButtons) b.setAttribute('aria-pressed', String(k === v))
    titleText.textContent = `Sentiment, English vs Polish: ${VIEW[v].name}`
    exploratory.hidden = !VIEW[v].exploratory
    sub.textContent = describeTest(testFor(v, opts.results))
    render(entered && !opts.reducedMotion)
    fillTable()
  }

  setHighlight('all')
  setView(view)

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

  return { setView }
}
