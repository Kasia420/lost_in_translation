import * as d3 from 'd3'
// d3's root package is marked side-effect-free, so production builds drop the module that adds
// selection.transition() / .interrupt(); importing it directly keeps it.
import 'd3-transition'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import type { DomainId } from '../lib/data'
import { el } from '../lib/dom'
import { DOMAIN_SYMBOL } from './scatter'

/**
 * One row per topic: the English value and the Polish value as two dots on a
 * shared axis, joined by a line. Colour = language, as everywhere on the site.
 */
export interface DumbbellRow {
  id: string
  topic: string
  domain: DomainId
  domainLabel: string
  en: number
  pl: number
}

export interface DumbbellView {
  id: string
  button: string
  title: string
  /** test line, built by the caller from results.json */
  subtitle: string
  rows: DumbbellRow[]
  /** medians from results.json (caller), drawn as reference lines */
  medians?: { en: number; pl: number }
  reference?: { value: number; label: string }
  exploratory?: boolean
}

export interface DumbbellOptions {
  views: DumbbellView[]
  initial: string
  xLabel: string
  /** used on narrow screens instead of xLabel */
  xLabelShort?: string
  /** fixed x extent shared by all views, so switching views never rescales the axis */
  domain: [number, number]
  ticks: number[]
  tickFormat: (v: number) => string
  format: (v: number) => string
  /** value the dots start from before they move to their measured position */
  start: number
  caption: string
  tableCaption: string
  wide?: boolean
  reducedMotion: boolean
}

const DOMAIN_ORDER: DomainId[] = ['contested_history', 'literature', 'social_norms']
const ROW_H = 24
const GROUP_H = 34
// vertical bands above the plot: EN median label, PL median label, reference label, tick labels
const Y_MED_EN = 16
const Y_MED_PL = 32
const Y_REF = 48
const TOP = 86
const BOTTOM = 46

interface Layout {
  y: Map<string, number>
  groups: { domain: DomainId; label: string; y: number }[]
  height: number
}

export function mountDumbbell(root: HTMLElement, opts: DumbbellOptions): { setView(id: string): void } {
  let view = opts.views.find((v) => v.id === opts.initial) ?? opts.views[0]
  let entered = opts.reducedMotion
  let focusIdx = -1
  let order: string[] = []
  let x = d3.scaleLinear()
  let layout: Layout = { y: new Map(), groups: [], height: 0 }
  let width = 0
  let left = 230

  // ---- DOM ----
  const titleText = el('span')
  const tag = el('span', { class: 'tag', text: 'exploratory' })
  const sub = el('p', { class: 'chart__sub' })
  const head = el('div', { class: 'chart__head' }, [el('h4', { class: 'chart__title' }, [titleText, tag]), sub])
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Data shown' })
  const buttons = new Map<string, HTMLButtonElement>()
  for (const v of opts.views) {
    const b = el('button', { type: 'button', text: v.button })
    b.addEventListener('click', () => setView(v.id))
    buttons.set(v.id, b)
    seg.append(b)
  }
  const controls = el('div', { class: 'chart__controls' }, opts.views.length > 1 ? [seg] : [])
  const plot = el('div', { class: 'chart__plot chart__plot--tall' })
  const tooltip = el('div', { class: 'tooltip', 'aria-hidden': 'true' })
  const live = el('p', { class: 'sr-only', 'aria-live': 'polite' })
  const legend = el('div', { class: 'legend' }, [
    el('span', {}, [el('i', { class: 'key key--en' }), 'English']),
    el('span', {}, [el('i', { class: 'key key--pl' }), 'Polish']),
    el('span', {}, [el('i', { class: 'key key--line-en' }), el('i', { class: 'key key--line-pl' }), 'Medians']),
  ])
  const caption = el('p', { class: 'caption', text: opts.caption })
  const tbody = el('tbody')
  const tcap = el('caption')
  const table = el('details', { class: 'datatable' }, [
    el('summary', { text: 'Show data table' }),
    el('div', { class: 'tablewrap' }, [
      el('table', {}, [
        tcap,
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
  root.replaceChildren(head, controls, plot, el('div', { class: 'chart__side' }, [legend, caption, table]), live)

  const svg = d3
    .select(plot)
    .append('svg')
    .attr('tabindex', 0)
    .attr('role', 'group')
    .attr('aria-roledescription', 'interactive chart')
  const gGrid = svg.append('g').attr('class', 'sc-grid')
  const gAxis = svg.append('g').attr('class', 'sc-axis')
  const gGroups = svg.append('g')
  const gRef = svg.append('g')
  const gMed = svg.append('g')
  const gRows = svg.append('g')
  const xTitle = svg.append('text').attr('class', 'sc-axis-title').attr('text-anchor', 'middle')
  const ring = svg.append('rect').attr('class', 'db-focus').attr('rx', 4).style('display', 'none')
  plot.append(tooltip)

  function computeLayout(rows: DumbbellRow[]): Layout {
    const y = new Map<string, number>()
    const groups: Layout['groups'] = []
    let cursor = TOP
    for (const d of DOMAIN_ORDER) {
      const inGroup = rows.filter((r) => r.domain === d)
      if (!inGroup.length) continue
      groups.push({ domain: d, label: inGroup[0].domainLabel, y: cursor + 22 })
      cursor += GROUP_H
      for (const r of inGroup) {
        y.set(r.id, cursor + ROW_H / 2)
        cursor += ROW_H
      }
    }
    return { y, groups, height: cursor + BOTTOM }
  }

  function render(animate: boolean) {
    width = Math.max(320, plot.clientWidth || 760)
    left = width < 560 ? 132 : 230
    layout = computeLayout(view.rows)
    x = d3.scaleLinear().domain(opts.domain).range([left, width - 24])
    const H = layout.height
    const plotTop = TOP - 6
    const plotBottom = H - BOTTOM + 4
    svg.attr('width', width).attr('height', H).attr('viewBox', `0 0 ${width} ${H}`)
    svg.attr('aria-label', `${view.title}. One row per topic with its English and Polish value. Use the arrow keys to step through topics.`)

    const tks = width < 560 ? opts.ticks.filter((_v, i) => i % 2 === 0) : opts.ticks
    gGrid
      .selectAll<SVGLineElement, number>('line')
      .data(tks)
      .join('line')
      .attr('x1', (d) => x(d))
      .attr('x2', (d) => x(d))
      .attr('y1', plotTop)
      .attr('y2', plotBottom)
    gAxis
      .selectAll<SVGTextElement, number>('text.top')
      .data(tks)
      .join('text')
      .attr('class', 'top')
      .attr('x', (d) => x(d))
      .attr('y', TOP - 16)
      .attr('text-anchor', 'middle')
      .text((d) => opts.tickFormat(d))
    gAxis
      .selectAll<SVGTextElement, number>('text.bottom')
      .data(tks)
      .join('text')
      .attr('class', 'bottom')
      .attr('x', (d) => x(d))
      .attr('y', plotBottom + 16)
      .attr('text-anchor', 'middle')
      .text((d) => opts.tickFormat(d))
    xTitle
      .attr('x', (left + width - 24) / 2)
      .attr('y', H - 6)
      .text(width < 560 && opts.xLabelShort ? opts.xLabelShort : opts.xLabel)

    // domain group headers: shape + label, the same identity as in the scatter
    const iconX = left > 140 ? 14 : 8
    gGroups
      .selectAll<SVGGElement, Layout['groups'][number]>('g.db-group')
      .data(layout.groups, (g) => g.domain)
      .join((enter) => {
        const g = enter.append('g').attr('class', 'db-group')
        g.append('path').attr('class', 'db-group__icon')
        g.append('text').attr('class', 'db-group__label')
        return g
      })
      .call((g) => {
        g.select<SVGPathElement>('path')
          .attr('d', (d) => d3.symbol(DOMAIN_SYMBOL[d.domain], 46)() ?? '')
          .attr('transform', (d) => `translate(${iconX},${d.y - 4})`)
        g.select<SVGTextElement>('text')
          .attr('x', iconX + 12)
          .attr('y', (d) => d.y)
          .text((d) => d.label)
      })

    // reference line (zero / target), label in its own band above the plot
    gRef
      .selectAll<SVGGElement, { value: number; label: string }>('g')
      .data(view.reference ? [view.reference] : [])
      .join((enter) => {
        const g = enter.append('g')
        g.append('line').attr('class', 'sc-diag')
        g.append('text').attr('class', 'sc-note')
        return g
      })
      .call((g) => {
        g.select('line')
          .attr('x1', (d) => x(d.value))
          .attr('x2', (d) => x(d.value))
          .attr('y1', plotTop)
          .attr('y2', plotBottom)
        g.select<SVGTextElement>('text')
          .attr('text-anchor', (d) => (x(d.value) > width - 200 ? 'end' : 'start'))
          .attr('x', (d) => x(d.value) + (x(d.value) > width - 200 ? -6 : 6))
          .attr('y', Y_REF)
          .text((d) => d.label)
      })

    // medians from results.json: one line per language, labels on separate bands
    type Med = { lang: 'en' | 'pl'; v: number; y: number }
    const meds: Med[] = view.medians
      ? [
          { lang: 'en', v: view.medians.en, y: Y_MED_EN },
          { lang: 'pl', v: view.medians.pl, y: Y_MED_PL },
        ]
      : []
    const medAll = gMed
      .selectAll<SVGGElement, Med>('g')
      .data(meds, (d) => d.lang)
      .join((enter) => {
        const g = enter.append('g')
        g.append('line').attr('class', (d) => `db-median db-median--${d.lang}`)
        g.append('text').attr('class', 'sc-note')
        return g
      })
    const anchorEnd = (d: Med) => x(d.v) > width - 200
    medAll
      .select<SVGLineElement>('line')
      .attr('y1', plotTop)
      .attr('y2', plotBottom)
      .transition()
      .duration(animate ? 900 : 0)
      .attr('x1', (d) => x(d.v))
      .attr('x2', (d) => x(d.v))
    medAll
      .select<SVGTextElement>('text')
      .attr('text-anchor', (d) => (anchorEnd(d) ? 'end' : 'start'))
      .attr('y', (d) => d.y)
      .text((d) => `${d.lang === 'en' ? 'EN' : 'PL'} median ${opts.format(d.v)}`)
      .transition()
      .duration(animate ? 900 : 0)
      .attr('x', (d) => x(d.v) + (anchorEnd(d) ? -6 : 6))

    // rows
    const rows = view.rows.filter((r) => layout.y.has(r.id))
    order = rows.map((r) => r.id)
    const all = gRows
      .selectAll<SVGGElement, DumbbellRow>('g.db-row')
      .data(rows, (r) => r.id)
      .join((enter) => {
        const g = enter.append('g').attr('class', 'db-row')
        g.append('rect').attr('class', 'db-hit')
        g.append('text').attr('class', 'db-label')
        g.append('line').attr('class', 'db-link')
        g.append('circle').attr('class', 'db-dot db-dot--en').attr('r', 5).attr('cx', x(opts.start))
        g.append('circle').attr('class', 'db-dot db-dot--pl').attr('r', 5).attr('cx', x(opts.start))
        return g
      })
    all.attr('transform', (r) => `translate(0,${layout.y.get(r.id) ?? 0})`)
    all
      .select<SVGRectElement>('rect')
      .attr('x', 0)
      .attr('y', -ROW_H / 2 + 1)
      .attr('width', width)
      .attr('height', ROW_H - 2)
    all
      .select<SVGTextElement>('text')
      .attr('x', left - 14)
      .attr('dy', '0.32em')
      .attr('text-anchor', 'end')
      .text((r) => r.topic)
      .each(function (r) {
        // shorten labels that would run into the plot; the full name is in the tooltip and table
        const max = left - 24
        let s = r.topic
        while (this.getComputedTextLength() > max && s.length > 4) {
          s = s.slice(0, -2)
          this.textContent = `${s.trimEnd()}…`
        }
      })

    const ex = (r: DumbbellRow) => (entered ? x(r.en) : x(opts.start))
    const px = (r: DumbbellRow) => (entered ? x(r.pl) : x(opts.start))
    const links = all.select<SVGLineElement>('line.db-link')
    const dotsEn = all.select<SVGCircleElement>('circle.db-dot--en')
    const dotsPl = all.select<SVGCircleElement>('circle.db-dot--pl')
    if (animate) {
      const delay = (_r: DumbbellRow, k: number) => k * 22
      links.transition().duration(1000).delay(delay).ease(d3.easeCubicOut).attr('x1', ex).attr('x2', px)
      dotsEn.transition().duration(1000).delay(delay).ease(d3.easeCubicOut).attr('cx', ex)
      dotsPl.transition().duration(1000).delay(delay).ease(d3.easeCubicOut).attr('cx', px)
    } else {
      links.interrupt().attr('x1', ex).attr('x2', px)
      dotsEn.interrupt().attr('cx', ex)
      dotsPl.interrupt().attr('cx', px)
    }
    hide()
  }

  function show(id: string, announce: boolean) {
    const r = view.rows.find((d) => d.id === id)
    const cy = layout.y.get(id)
    if (!r || cy === undefined) return
    focusIdx = order.indexOf(id)
    ring
      .attr('x', 1)
      .attr('y', cy - ROW_H / 2 + 1)
      .attr('width', width - 2)
      .attr('height', ROW_H - 2)
      .style('display', null)
    tooltip.replaceChildren(
      el('div', { class: 'tt__vals' }, [
        el('span', {}, [opts.format(r.en), el('small', { text: 'EN' })]),
        el('span', {}, [opts.format(r.pl), el('small', { text: 'PL' })]),
      ]),
      el('div', { class: 'tt__label', text: r.topic }),
      el('div', { class: 'tt__meta', text: `${r.domainLabel} · PL − EN ${opts.format(r.pl - r.en)}` }),
    )
    const cx = (x(r.en) + x(r.pl)) / 2
    tooltip.style.left = `${Math.min(Math.max(cx, 120), width - 120)}px`
    tooltip.style.top = `${cy - 10}px`
    tooltip.style.transform = ''
    tooltip.classList.add('is-on')
    if (announce) live.textContent = `${r.topic}: English ${opts.format(r.en)}, Polish ${opts.format(r.pl)}.`
  }

  function hide() {
    ring.style('display', 'none')
    tooltip.classList.remove('is-on')
  }

  svg.on('pointermove', (ev: PointerEvent) => {
    if (!entered) return
    const [, py] = d3.pointer(ev)
    let best: string | null = null
    for (const [id, y] of layout.y) if (Math.abs(y - py) <= ROW_H / 2) best = id
    if (best) show(best, false)
    else hide()
  })
  svg.on('pointerleave', hide)
  svg.on('focus', () => {
    if (!entered) {
      entered = true
      render(false)
    }
    show(order[Math.max(0, focusIdx)], true)
  })
  svg.on('blur', hide)
  svg.on('keydown', (ev: KeyboardEvent) => {
    if (!order.length) return
    const at = Math.max(0, focusIdx)
    let k = -1
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') k = (at + 1) % order.length
    else if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') k = (at - 1 + order.length) % order.length
    else if (ev.key === 'Home') k = 0
    else if (ev.key === 'End') k = order.length - 1
    else if (ev.key === 'Escape') {
      hide()
      return
    } else return
    ev.preventDefault()
    show(order[k], true)
  })

  function fillTable() {
    tcap.textContent = `${view.title} (${opts.tableCaption})`
    tbody.replaceChildren(
      ...view.rows.map((r) =>
        el('tr', {}, [
          el('td', { text: r.topic }),
          el('td', { text: r.domainLabel }),
          el('td', { class: 'num', text: opts.format(r.en) }),
          el('td', { class: 'num', text: opts.format(r.pl) }),
          el('td', { class: 'num', text: opts.format(r.pl - r.en) }),
        ]),
      ),
    )
  }

  function setView(id: string) {
    const v = opts.views.find((w) => w.id === id)
    if (!v) return
    view = v
    for (const [k, b] of buttons) b.setAttribute('aria-pressed', String(k === id))
    titleText.textContent = v.title
    tag.hidden = !v.exploratory
    sub.textContent = v.subtitle
    render(entered && !opts.reducedMotion)
    fillTable()
  }

  setView(view.id)
  if (!entered) {
    ScrollTrigger.create({
      trigger: plot,
      start: 'top 75%',
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
