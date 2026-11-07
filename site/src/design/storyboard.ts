import { el } from '../lib/dom'

export type LiveSlot = 'hero' | 'cards' | 'cloud' | 'scatter' | 'scatter-wiki'

interface Frame {
  no: string
  title: string
  live?: LiveSlot
  sketch?: keyof typeof SKETCHES
  data: string
  interaction: string
  motion: string
  still: string
}

export interface StoryCounts {
  topics: number
  answers: number
  wikiLeads: number
  tatoebaPairs: number
  cloudPoints: number
}

function frames(c: StoryCounts): Frame[] {
  return [
    {
      no: '00',
      title: 'Loading screen',
      live: 'hero',
      data: `Counts the real files as they load (4 data files and the fonts).`,
      interaction: 'None; plays once per visit.',
      motion: 'Percent counter, then the title assembles letter by letter through both alphabets.',
      still: 'Title shown at once, no counter.',
    },
    {
      no: '01',
      title: 'Hero',
      live: 'hero',
      data: 'Research question: Kasia’s text from the README, verbatim.',
      interaction: 'The EN / PL switch in the top bar changes the language of the whole site.',
      motion: 'The title keeps morphing between English and Polish; it pauses while off screen.',
      still: 'Static title in the chosen language.',
    },
    {
      no: '02',
      title: 'The experiment',
      live: 'cards',
      data: `topics.json: ${c.topics} prompt pairs. Counters from the data: ${c.answers} answers (v1 + v2), ${c.wikiLeads} Wikipedia leads, ${c.tatoebaPairs.toLocaleString('en-US')} Tatoeba pairs.`,
      interaction: 'Click a card to flip between the English and the Polish prompt. Final version: all 25 cards, filterable by domain.',
      motion: 'Cards deal in as you scroll; the counters roll up.',
      still: 'Static grid of cards.',
    },
    {
      no: '03',
      title: 'Inside the model’s head',
      live: 'cloud',
      data: `embeddings3d.json (${c.cloudPoints} points, PCA of the LaBSE embeddings) and the study’s cosine values from topics.json.`,
      interaction: 'Drag to rotate, hover a point, switch v2 / v1, show the Wikipedia leads.',
      motion: 'Slow rotation (can be paused); switching runs moves every point to its position in the other run.',
      still: 'No rotation; the data table lists every cosine.',
    },
    {
      no: '04',
      title: 'Tone',
      live: 'scatter',
      data: 'Sentiment of every answer (topics.json); test results from results.json.',
      interaction: 'Switch v2 / v1, highlight a domain, hover or use the arrow keys, open the data table.',
      motion: 'Points start on the EN = PL line and move to their measured values.',
      still: 'Points drawn in place.',
    },
    {
      no: '05',
      title: 'Model or sources?',
      live: 'scatter-wiki',
      data: 'Wikipedia lead sentiment and the answers-vs-Wikipedia gap test (results.json).',
      interaction: 'Switch between the answers and the Wikipedia leads: the same topics move between the two states.',
      motion: 'Points glide from one state to the other.',
      still: 'Two static charts side by side.',
    },
    {
      no: '06',
      title: 'Is the classifier biased?',
      sketch: 'rain',
      data: `tatoeba.json: ${c.tatoebaPairs.toLocaleString('en-US')} EN–PL sentence pairs scored by the same classifier; the calibration test from results.json.`,
      interaction: 'Hover a particle to read that sentence pair, with a link to it on Tatoeba.',
      motion: 'The pairs fall as particles and stack into a histogram of PL − EN differences.',
      still: 'Static histogram and table.',
    },
    {
      no: '07',
      title: 'Tug of war',
      sketch: 'rope',
      data: 'Native pull of every answer (topics.json) and the EN vs PL test (results.json).',
      interaction: 'Each topic is a rope between English and Polish Wikipedia; switch v1 / v2.',
      motion: 'The ropes pull tight into their measured positions.',
      still: 'Dot plot.',
    },
    {
      no: '08',
      title: 'How long is an answer?',
      sketch: 'ribbons',
      data: 'Words and markdown-free words per answer (topics.json); the v2 length instruction (meta.json).',
      interaction: 'Hover a bar to read the first lines of that answer.',
      motion: 'Bars made of each answer’s own text grow to their length; target line at 150 words.',
      still: 'Plain bar chart.',
    },
    {
      no: '09',
      title: 'Read the answers',
      sketch: 'explorer',
      data: 'Everything in topics.json.',
      interaction: 'Pick a topic: EN and PL answers side by side, the Wikipedia leads and every metric; search and filter.',
      motion: 'Minimal.',
      still: 'This page is also the no-animation route to every number on the site.',
    },
    {
      no: '10',
      title: 'What it means',
      sketch: 'text',
      data: 'Kasia’s interpretation and conclusion, verbatim from the README, plus the limitations.',
      interaction: 'None.',
      motion: 'Gentle text reveal.',
      still: 'Plain text.',
    },
    {
      no: '11',
      title: 'Under the hood',
      sketch: 'pipeline',
      data: 'Pipeline (collect → analyse → export → site), the tech stack, the source commit from meta.json, the AI-use note.',
      interaction: '“Show the data” buttons open the JSON behind each chart.',
      motion: 'The pipeline diagram draws itself.',
      still: 'Static diagram.',
    },
    {
      no: '12',
      title: 'About and contact',
      sketch: 'contact',
      data: 'Links: GitHub, LinkedIn, CV.',
      interaction: 'Links.',
      motion: 'None.',
      still: 'Same.',
    },
  ]
}

/** Deterministic pseudo-random numbers, so the sketches look the same every time. */
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const SKETCHES = {
  rain: () => {
    const r = rng(7)
    const drops = Array.from({ length: 46 }, () => {
      const x = 40 + r() * 320
      const y = 10 + r() * 60
      return `<circle class="sk-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2"/>`
    }).join('')
    const heights = [4, 8, 15, 28, 46, 60, 46, 27, 14, 7, 3]
    const bars = heights
      .map((h, i) => `<rect class="sk-fill" x="${95 + i * 19}" y="${140 - h}" width="15" height="${h}" rx="2"/>`)
      .join('')
    return `${drops}${bars}<line class="sk-line" x1="200" y1="72" x2="200" y2="142"/><text class="sk-text" x="204" y="80">0</text>`
  },
  rope: () =>
    Array.from({ length: 5 }, (_, i) => {
      const y = 22 + i * 26
      const a = 120 + ((i * 37) % 70)
      const b = 200 + ((i * 53) % 90)
      return `<line class="sk-line" x1="40" y1="${y}" x2="360" y2="${y}"/><circle class="sk-en" cx="${a}" cy="${y}" r="5"/><circle class="sk-pl" cx="${b}" cy="${y}" r="5"/>`
    }).join('') +
    `<rect class="sk-fill" x="28" y="10" width="8" height="132" rx="2"/><rect class="sk-fill" x="364" y="10" width="8" height="132" rx="2"/>` +
    `<text class="sk-text" x="28" y="150">EN wiki</text><text class="sk-text" x="372" y="150" text-anchor="end">PL wiki</text>`,
  ribbons: () => {
    const lens = [
      [210, 170],
      [196, 150],
      [220, 182],
      [204, 140],
    ]
    return (
      lens
        .map(
          ([en, pl], i) =>
            `<rect class="sk-en" x="40" y="${24 + i * 32}" width="${en}" height="9" rx="2"/><rect class="sk-pl" x="40" y="${35 + i * 32}" width="${pl}" height="9" rx="2"/>`,
        )
        .join('') + `<line class="sk-line" x1="230" y1="16" x2="230" y2="150"/><text class="sk-text" x="230" y="10" text-anchor="middle">150 words</text>`
    )
  },
  explorer: () =>
    `<rect class="sk-fill" x="20" y="10" width="110" height="130" rx="4"/>` +
    [0, 1, 2, 3, 4].map((i) => `<rect class="sk-bg" x="30" y="${22 + i * 22}" width="${70 + ((i * 13) % 20)}" height="8" rx="2"/>`).join('') +
    `<circle class="sk-en" cx="150" cy="18" r="4"/><circle class="sk-pl" cx="270" cy="18" r="4"/>` +
    [0, 1, 2, 3, 4, 5, 6].map((i) => `<rect class="sk-fill" x="150" y="${32 + i * 15}" width="${100 - ((i * 17) % 30)}" height="6" rx="2"/><rect class="sk-fill" x="270" y="${32 + i * 15}" width="${96 - ((i * 23) % 34)}" height="6" rx="2"/>`).join(''),
  text: () =>
    [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect class="sk-fill" x="40" y="${16 + i * 16}" width="${i === 3 || i === 7 ? 180 : 310 - ((i * 19) % 50)}" height="7" rx="2"/>`).join(''),
  pipeline: () => {
    const steps = ['collect', 'analyse', 'export', 'site']
    return steps
      .map((s, i) => {
        const x = 16 + i * 96
        const arrow = i < steps.length - 1 ? `<line class="sk-line" x1="${x + 76}" y1="75" x2="${x + 94}" y2="75"/><path class="sk-arrow" d="M${x + 94} 75 l-6 -4 v8 z"/>` : ''
        return `<rect class="sk-box" x="${x}" y="52" width="76" height="46" rx="4"/><text class="sk-text" x="${x + 38}" y="79" text-anchor="middle">${s}</text>${arrow}`
      })
      .join('')
  },
  contact: () =>
    ['GitHub', 'LinkedIn', 'CV']
      .map((s, i) => `<circle class="sk-box" cx="${110 + i * 90}" cy="64" r="26"/><text class="sk-text" x="${110 + i * 90}" y="112" text-anchor="middle">${s}</text>`)
      .join(''),
}

export function mountStoryboard(root: HTMLElement, counts: StoryCounts, onReplay: () => void): Map<LiveSlot, HTMLElement> {
  const mounts = new Map<LiveSlot, HTMLElement>()
  const items = frames(counts).map((f) => {
    const badge = el('span', { class: `tag frame__badge${f.live ? ' is-live' : ''}`, text: f.live ? 'Live prototype' : 'Wireframe' })
    const head = el('header', { class: 'frame__head' }, [
      el('span', { class: 'frame__no', text: f.no }),
      el('h3', { class: 'display frame__title', text: f.title }),
      badge,
    ])
    let body: HTMLElement
    if (f.live === 'hero') {
      const replay = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Replay the intro at the top' })
      replay.addEventListener('click', onReplay)
      body = el('div', {}, [el('p', { text: 'Live at the top of this page.' }), replay])
    } else if (f.live) {
      body = el('div', { class: 'frame__proto' })
      mounts.set(f.live, body)
    } else {
      body = el('div', { class: 'frame__sketch', 'aria-hidden': 'true' })
      body.innerHTML = `<svg viewBox="0 0 400 155" preserveAspectRatio="xMidYMid meet">${SKETCHES[f.sketch ?? 'text']()}</svg>` // static markup only
    }
    const spec = el('dl', { class: 'frame__spec' }, [
      el('dt', { class: 'label', text: 'Data' }),
      el('dd', { text: f.data }),
      el('dt', { class: 'label', text: 'Interaction' }),
      el('dd', { text: f.interaction }),
      el('dt', { class: 'label', text: 'Motion' }),
      el('dd', { text: f.motion }),
      el('dt', { class: 'label', text: 'Without motion' }),
      el('dd', { text: f.still }),
    ])
    const wide = f.live && f.live !== 'hero'
    return el('article', { class: `frame reveal${wide ? ' frame--live' : ''}`, id: `ch-${f.no}`, 'aria-labelledby': `ch-${f.no}-title` }, [
      head,
      body,
      spec,
    ])
  })
  root.replaceChildren(...items)
  for (const item of items) item.querySelector('h3')?.setAttribute('id', `${item.id}-title`)
  return mounts
}
