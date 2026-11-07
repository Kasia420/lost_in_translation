import { gsap } from 'gsap'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { CloudPoint, Lang, Meta, RunId, Topic } from '../lib/data'
import { cssVar, el, hexToRgb } from '../lib/dom'
import { percent, unsigned } from '../lib/format'

/*
 * The 3D map of the answers. Points are round sprites drawn by a small shader;
 * colours are written as sRGB and output unchanged, so they match the CSS
 * tokens exactly. Far points are drawn dimmer and smaller (a depth cue).
 *
 * On arrival the points assemble from a loose sphere into their positions.
 * Clicking a point (or choosing a topic from the list) focuses that topic: its
 * pair stays bright, everything else dims, and the camera glides to it.
 */
const VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
uniform float uSize;
uniform float uPixelRatio;
uniform float uDist;
uniform float uNear;
uniform float uFar;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float depth = -mv.z;
  vAlpha = aAlpha * (1.0 - 0.55 * smoothstep(uNear, uFar, depth));
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uPixelRatio * aSize * clamp(uDist / depth, 0.75, 1.35);
}`

const FRAG = /* glsl */ `
uniform float uHollow;
uniform float uOpacity;
uniform float uGlow;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float core = 1.0 - smoothstep(0.22, 0.26, d);
  if (uHollow > 0.5) core *= smoothstep(0.13, 0.16, d);
  float halo = (1.0 - smoothstep(0.08, 0.5, d)) * 0.28 * uGlow;
  gl_FragColor = vec4(vColor, max(core, halo) * uOpacity * vAlpha);
}`

const SPRITE_PX = 24 // sprite box; the dot inside is about 11 px across
const HOVER_PX = 18
const CLICK_SLOP = 5 // px a pointer may move and still count as a click, not a drag

interface Slot {
  topic: Topic
  lang: Lang
  kind: 'answer' | 'wikipedia'
}

const LANG_NAME: Record<Lang, string> = { en: 'English', pl: 'Polish' }

/** First words of a Markdown answer as plain text. */
export function excerpt(md: string, n = 120): string {
  const plain = md
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*([-*+•]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > n ? `${plain.slice(0, n - 1).trimEnd()}…` : plain
}

/** Deterministic random numbers for the start positions. */
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

export interface CloudOptions {
  topics: Topic[]
  points: CloudPoint[]
  meta: Meta
  reducedMotion: boolean
  direction: string
  /** "Read both answers": open the topic in the answer explorer */
  onOpenTopic?: (id: string) => void
}

export function mountCloud(root: HTMLElement, opts: CloudOptions): void {
  let run: RunId = 'v2'
  let selected: Topic | null = null
  let userPaused = opts.reducedMotion

  // ---- DOM ----
  const runSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Run' })
  const runButtons = new Map<RunId, HTMLButtonElement>()
  for (const r of ['v2', 'v1'] as const) {
    const b = el('button', { type: 'button', text: `Answers ${r}`, 'aria-pressed': String(r === run) })
    b.addEventListener('click', () => setRun(r))
    runButtons.set(r, b)
    runSeg.append(b)
  }
  const topicSelect = el('select', { class: 'select select--small', id: 'cloud-topic' })
  topicSelect.append(el('option', { value: '', text: 'All topics' }))
  for (const d of opts.meta.domains) {
    const group = el('optgroup', { label: d.label })
    for (const t of opts.topics.filter((x) => x.domain === d.id)) group.append(el('option', { value: t.id, text: t.topic }))
    topicSelect.append(group)
  }
  topicSelect.addEventListener('change', () => select(opts.topics.find((t) => t.id === topicSelect.value) ?? null))
  const focusPick = el('label', { class: 'toggle', for: 'cloud-topic' }, ['Focus', topicSelect])
  const wikiBox = el('input', { type: 'checkbox' })
  const wikiToggle = el('label', { class: 'toggle' }, [wikiBox, 'Show Wikipedia leads'])
  const pauseBtn = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(userPaused), text: 'Pause rotation' })
  const controlsRow = el('div', { class: 'chart__controls' }, [runSeg, focusPick, wikiToggle, pauseBtn])
  const stage = el('div', {
    class: 'cloud__stage',
    role: 'img',
    'aria-label':
      '3D map of the answers: each English answer and its Polish counterpart are joined by a thread. ' +
      'Use the Focus list to pick a topic; the table below lists the same cosine values.',
  })
  const tooltip = el('div', { class: 'tooltip', 'aria-hidden': 'true' })
  const card = el('div', { class: 'cloud__card', hidden: '', 'aria-live': 'polite' })
  const legend = el('div', { class: 'legend' }, [
    el('span', {}, [el('i', { class: 'key key--en' }), 'English answer']),
    el('span', {}, [el('i', { class: 'key key--pl' }), 'Polish answer']),
    el('span', {}, [el('i', { class: 'key key--hollow-en' }), el('i', { class: 'key key--hollow-pl' }), 'Wikipedia lead (EN, PL)']),
    el('span', { text: 'Thread: same topic' }),
  ])
  const ev = opts.meta.projection.explained_variance_ratio
  const caption = el('p', {
    class: 'caption',
    text:
      `3D map made with PCA from ${opts.meta.projection.input}, all ${opts.meta.projection.n_points} points fitted together. ` +
      `The three axes keep ${percent(ev.reduce((a, b) => a + b, 0))} of the variation ` +
      `(${ev.map((v) => percent(v)).join(' + ')}), so distances here are approximate. ` +
      'Hover a point for the cosine similarity used in the study; click it to focus that topic.',
  })
  const table = buildTable(opts.topics)
  root.classList.add('cloud')
  root.replaceChildren(controlsRow, stage, legend, caption, table)

  // ---- three.js ----
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  } catch {
    stage.replaceChildren(
      el('p', { class: 'cloud__fallback', text: 'This browser cannot show the 3D view (WebGL is off). The table below has the same values.' }),
    )
    return
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)
  stage.append(renderer.domElement, tooltip, card)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.enableZoom = false // never trap the page scroll
  controls.rotateSpeed = 0.6
  controls.autoRotate = !userPaused
  controls.autoRotateSpeed = 0.7
  // vertical swipes scroll the page on touch screens; horizontal drags rotate
  renderer.domElement.style.touchAction = 'pan-y'

  const byId = new Map(opts.points.map((p) => [p.id, p]))
  const need = (id: string): CloudPoint => {
    const p = byId.get(id)
    if (!p) throw new Error(`embeddings3d.json: missing point ${id}`)
    return p
  }
  const answerSlots: Slot[] = opts.topics.flatMap((t) => (['en', 'pl'] as const).map((lang) => ({ topic: t, lang, kind: 'answer' as const })))
  const wikiSlots: Slot[] = opts.topics
    .filter((t) => t.wikipedia)
    .flatMap((t) => (['en', 'pl'] as const).map((lang) => ({ topic: t, lang, kind: 'wikipedia' as const })))

  const positionsFor = (r: RunId) => {
    const a = new Float32Array(answerSlots.length * 3)
    answerSlots.forEach((s, i) => {
      const p = need(`${r}:${s.topic.id}:${s.lang}`)
      a.set([p.x, p.y, p.z], i * 3)
    })
    return a
  }
  const pos = { v2: positionsFor('v2'), v1: positionsFor('v1') }
  const wikiFinal = new Float32Array(wikiSlots.length * 3)
  wikiSlots.forEach((s, i) => {
    const p = need(`wiki:${s.topic.id}:${s.lang}`)
    wikiFinal.set([p.x, p.y, p.z], i * 3)
  })

  let radius = 0
  for (const arr of [pos.v1, pos.v2, wikiFinal]) {
    for (let i = 0; i < arr.length; i += 3) radius = Math.max(radius, Math.hypot(arr[i], arr[i + 1], arr[i + 2]))
  }

  // start positions for the assembly: a loose sphere around the map
  const rand = mulberry32(2026)
  const onSphere = (n: number) => {
    const a = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const u = rand() * 2 - 1
      const phi = rand() * Math.PI * 2
      const r = radius * (1.6 + rand() * 0.9)
      const s = Math.sqrt(1 - u * u)
      a.set([r * s * Math.cos(phi), r * u, r * s * Math.sin(phi)], i * 3)
    }
    return a
  }
  const startAnswers = onSphere(answerSlots.length)

  const rgb = { en: hexToRgb(cssVar('--en')), pl: hexToRgb(cssVar('--pl')) }
  const colours = (slots: Slot[]) => {
    const c = new Float32Array(slots.length * 3)
    slots.forEach((s, i) => c.set(rgb[s.lang], i * 3))
    return c
  }
  const uniforms = (hollow: boolean) => ({
    uSize: { value: SPRITE_PX },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uDist: { value: 4 },
    uNear: { value: 2 },
    uFar: { value: 6 },
    uHollow: { value: hollow ? 1 : 0 },
    uOpacity: { value: hollow ? 0 : 1 },
    uGlow: { value: opts.direction === 'orbit' ? 1 : 0 },
  })
  const material = (hollow: boolean) =>
    new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, uniforms: uniforms(hollow) })

  const answerPos = new Float32Array(opts.reducedMotion ? pos.v2 : startAnswers)
  const answerSize = new Float32Array(answerSlots.length).fill(1)
  const answerAlpha = new Float32Array(answerSlots.length).fill(1)
  const answerGeom = new THREE.BufferGeometry()
  answerGeom.setAttribute('position', new THREE.BufferAttribute(answerPos, 3))
  answerGeom.setAttribute('aColor', new THREE.BufferAttribute(colours(answerSlots), 3))
  answerGeom.setAttribute('aSize', new THREE.BufferAttribute(answerSize, 1))
  answerGeom.setAttribute('aAlpha', new THREE.BufferAttribute(answerAlpha, 1))
  const answerMat = material(false)
  const answers = new THREE.Points(answerGeom, answerMat)

  const wikiSize = new Float32Array(wikiSlots.length).fill(1)
  const wikiAlpha = new Float32Array(wikiSlots.length).fill(1)
  const wikiGeom = new THREE.BufferGeometry()
  wikiGeom.setAttribute('position', new THREE.BufferAttribute(wikiFinal, 3))
  wikiGeom.setAttribute('aColor', new THREE.BufferAttribute(colours(wikiSlots), 3))
  wikiGeom.setAttribute('aSize', new THREE.BufferAttribute(wikiSize, 1))
  wikiGeom.setAttribute('aAlpha', new THREE.BufferAttribute(wikiAlpha, 1))
  const wikiMat = material(true)
  const wiki = new THREE.Points(wikiGeom, wikiMat)
  wiki.visible = false

  // threads: EN/PL slots are consecutive per topic, exactly the LineSegments layout
  const linePos = new Float32Array(answerPos.length)
  const lineGeom = new THREE.BufferGeometry()
  lineGeom.setAttribute('position', new THREE.BufferAttribute(linePos, 3))
  const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(cssVar('--text-3')), transparent: true, opacity: opts.reducedMotion ? 0.45 : 0 })
  const lines = new THREE.LineSegments(lineGeom, lineMat)
  // the focused topic's thread, drawn bright on top
  const focusPos = new Float32Array(6)
  const focusGeom = new THREE.BufferGeometry()
  focusGeom.setAttribute('position', new THREE.BufferAttribute(focusPos, 3))
  const focusMat = new THREE.LineBasicMaterial({ color: new THREE.Color(cssVar('--text')), transparent: true, opacity: 0.9 })
  const focusLine = new THREE.LineSegments(focusGeom, focusMat)
  focusLine.visible = false
  scene.add(lines, answers, wiki, focusLine)

  const state = { morph: 0, assemble: opts.reducedMotion ? 1 : 0 } // morph: 0 = v2, 1 = v1
  const slotIndex = (t: Topic) => answerSlots.findIndex((s) => s.topic === t) // EN slot; PL is +1
  function updatePositions() {
    const a = state.assemble
    for (let i = 0; i < answerPos.length; i++) {
      const target = pos.v2[i] + (pos.v1[i] - pos.v2[i]) * state.morph
      answerPos[i] = startAnswers[i] + (target - startAnswers[i]) * a
    }
    answerGeom.attributes.position.needsUpdate = true
    linePos.set(answerPos)
    lineGeom.attributes.position.needsUpdate = true
    if (selected) {
      const i = slotIndex(selected)
      focusPos.set(answerPos.subarray(i * 3, i * 3 + 6))
      focusGeom.attributes.position.needsUpdate = true
    }
  }
  updatePositions()

  // ---- camera ----
  const view = { dist: 4 }
  let baseDist = 4
  const setDepthUniforms = () => {
    const d = camera.position.distanceTo(controls.target)
    for (const mat of [answerMat, wikiMat]) {
      mat.uniforms.uDist.value = d
      mat.uniforms.uNear.value = Math.max(0.1, d - radius)
      mat.uniforms.uFar.value = d + radius
    }
  }
  const applyDistance = () => {
    const dir = camera.position.clone().sub(controls.target).normalize()
    camera.position.copy(controls.target).addScaledVector(dir, view.dist)
    setDepthUniforms()
  }
  const resize = () => {
    const w = stage.clientWidth || 800
    const h = Math.round(Math.min(560, Math.max(360, w * 0.6)))
    renderer.setSize(w, h)
    camera.aspect = w / h
    const fit = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))
    baseDist = (camera.aspect < 1 ? fit / camera.aspect : fit) * 1.08 || 4
    if (!selected) view.dist = baseDist
    camera.updateProjectionMatrix()
    applyDistance()
  }
  camera.position.set(0, 0, 4)
  resize()
  new ResizeObserver(resize).observe(stage)

  // ---- render loop, only while on screen; the assembly plays the first time ----
  let raf = 0
  let assembled = opts.reducedMotion
  const loop = () => {
    raf = requestAnimationFrame(loop)
    controls.update()
    setDepthUniforms()
    renderer.render(scene, camera)
  }
  new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting && !raf) {
        loop()
        if (!assembled) {
          assembled = true
          gsap.to(state, { assemble: 1, duration: 2.4, ease: 'expo.out', onUpdate: updatePositions })
          gsap.to(lineMat, { opacity: selected ? 0.1 : 0.45, duration: 1.2, delay: 1.2 })
        }
      } else if (!entry.isIntersecting && raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    },
    { threshold: 0.25 },
  ).observe(stage)

  // ---- picking: nearest point on screen ----
  const v = new THREE.Vector3()
  type Hit = { slot: Slot; sx: number; sy: number }
  function pick(clientX: number, clientY: number): Hit | null {
    const rect = renderer.domElement.getBoundingClientRect()
    let best: (Hit & { d: number }) | null = null
    const scan = (slots: Slot[], arr: Float32Array) => {
      slots.forEach((slot, i) => {
        v.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]).project(camera)
        const sx = ((v.x + 1) / 2) * rect.width
        const sy = ((1 - v.y) / 2) * rect.height
        const d = Math.hypot(sx - (clientX - rect.left), sy - (clientY - rect.top))
        if (d <= HOVER_PX && (!best || d < best.d)) best = { slot, sx, sy, d }
      })
    }
    scan(answerSlots, answerPos)
    if (wiki.visible && wikiMat.uniforms.uOpacity.value > 0.5) scan(wikiSlots, wikiFinal)
    return best
  }

  function showTip(hit: Hit) {
    const { slot } = hit
    if (slot.kind === 'answer') {
      const r = slot.topic.runs[run]
      const ans = r.answers[slot.lang]
      tooltip.replaceChildren(
        el('div', { class: 'tt__vals' }, [unsigned(r.cosine_en_pl), el('small', { text: 'cosine EN–PL' })]),
        el('div', { class: 'tt__label', text: slot.topic.topic }),
        el('div', { class: 'tt__meta', text: `${LANG_NAME[slot.lang]} answer · ${run} · ${ans.words} words` }),
        el('div', { class: 'tt__excerpt', lang: slot.lang, text: excerpt(ans.text, 110) }),
      )
    } else {
      const w = slot.topic.wikipedia?.[slot.lang]
      tooltip.replaceChildren(
        el('div', { class: 'tt__vals', text: 'Wikipedia lead' }),
        el('div', { class: 'tt__label', text: w?.title ?? slot.topic.topic }),
        el('div', { class: 'tt__meta', text: `${LANG_NAME[slot.lang]} Wikipedia · ${slot.topic.topic}` }),
        el('div', { class: 'tt__excerpt', lang: slot.lang, text: excerpt(w?.lead ?? '', 110) }),
      )
    }
    tooltip.style.left = `${Math.min(Math.max(hit.sx, 130), stage.clientWidth - 130)}px`
    tooltip.style.top = `${hit.sy}px`
    tooltip.style.transform = hit.sy < 150 ? 'translate(-50%, 18px)' : ''
    tooltip.classList.add('is-on')
  }

  let down: { x: number; y: number } | null = null
  renderer.domElement.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY }
  })
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP) return
    down = null
    const hit = pick(e.clientX, e.clientY)
    if (hit) select(hit.slot.topic)
    else if (selected) select(null)
  })
  renderer.domElement.addEventListener('pointermove', (e) => {
    const hit = pick(e.clientX, e.clientY)
    if (hit) showTip(hit)
    else tooltip.classList.remove('is-on')
    renderer.domElement.style.cursor = hit ? 'pointer' : ''
  })
  renderer.domElement.addEventListener('pointerleave', () => tooltip.classList.remove('is-on'))

  // ---- focus a topic ----
  function fillCard(t: Topic) {
    const r = t.runs[run]
    const close = el('button', { class: 'cloud__close', type: 'button', 'aria-label': 'Clear the focus', text: '×' })
    close.addEventListener('click', () => select(null))
    const open = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Read both answers' })
    open.addEventListener('click', () => opts.onOpenTopic?.(t.id))
    card.replaceChildren(
      close,
      el('span', { class: 'label', text: `${t.domain_label} · ${run}` }),
      el('h4', { class: 'cloud__title', text: t.topic }),
      el('div', { class: 'cloud__cos' }, [el('span', { class: 'figure', text: unsigned(r.cosine_en_pl) }), el('small', { text: 'cosine EN–PL (LaBSE)' })]),
      ...(['en', 'pl'] as const).map((lang) =>
        el('p', { class: 'cloud__excerpt', lang }, [el('i', { class: `key key--${lang}` }), excerpt(r.answers[lang].text, 140)]),
      ),
      ...(opts.onOpenTopic ? [open] : []),
    )
  }

  function select(t: Topic | null) {
    selected = t
    topicSelect.value = t?.id ?? ''
    answerSlots.forEach((s, i) => {
      answerSize[i] = t ? (s.topic === t ? 1.7 : 0.85) : 1
      answerAlpha[i] = t ? (s.topic === t ? 1 : 0.16) : 1
    })
    wikiSlots.forEach((s, i) => {
      wikiSize[i] = t && s.topic === t ? 1.4 : 1
      wikiAlpha[i] = t ? (s.topic === t ? 1 : 0.16) : 1
    })
    for (const g of [answerGeom, wikiGeom]) {
      g.attributes.aSize.needsUpdate = true
      g.attributes.aAlpha.needsUpdate = true
    }
    focusLine.visible = !!t
    gsap.to(lineMat, { opacity: t ? 0.1 : 0.45, duration: opts.reducedMotion ? 0 : 0.5 })
    updatePositions()

    if (t) {
      fillCard(t)
      card.hidden = false
      controls.autoRotate = false
    } else {
      card.hidden = true
      controls.autoRotate = !userPaused
    }

    // glide to the pair (or back to the whole map)
    const i = t ? slotIndex(t) : -1
    const target = t
      ? new THREE.Vector3(
          (answerPos[i * 3] + answerPos[i * 3 + 3]) / 2,
          (answerPos[i * 3 + 1] + answerPos[i * 3 + 4]) / 2,
          (answerPos[i * 3 + 2] + answerPos[i * 3 + 5]) / 2,
        )
      : new THREE.Vector3(0, 0, 0)
    const dur = opts.reducedMotion ? 0 : 1.1
    gsap.to(controls.target, { x: target.x, y: target.y, z: target.z, duration: dur, ease: 'power3.inOut', onUpdate: applyDistance })
    gsap.to(view, { dist: t ? baseDist * 0.62 : baseDist, duration: dur, ease: 'power3.inOut', onUpdate: applyDistance })
  }

  function setRun(r: RunId) {
    run = r
    for (const [k, b] of runButtons) b.setAttribute('aria-pressed', String(k === r))
    tooltip.classList.remove('is-on')
    gsap.to(state, {
      morph: r === 'v1' ? 1 : 0,
      duration: opts.reducedMotion ? 0 : 1.4,
      ease: 'power2.inOut',
      onUpdate: updatePositions,
      onComplete: () => {
        if (selected) select(selected) // re-centre on the pair's new position, refresh the card
      },
    })
  }

  wikiBox.addEventListener('change', () => {
    const on = wikiBox.checked
    if (on) wiki.visible = true
    gsap.to(wikiMat.uniforms.uOpacity, {
      value: on ? 1 : 0,
      duration: opts.reducedMotion ? 0 : 0.5,
      onComplete: () => {
        if (!on) wiki.visible = false
      },
    })
  })

  pauseBtn.addEventListener('click', () => {
    userPaused = !userPaused
    pauseBtn.setAttribute('aria-pressed', String(userPaused))
    if (!selected) controls.autoRotate = !userPaused
  })

  window.addEventListener('directionchange', (e) => {
    const direction = (e as CustomEvent<string>).detail
    lineMat.color.set(cssVar('--text-3'))
    focusMat.color.set(cssVar('--text'))
    answerMat.uniforms.uGlow.value = direction === 'orbit' ? 1 : 0
    wikiMat.uniforms.uGlow.value = direction === 'orbit' ? 1 : 0
  })
}

function buildTable(topics: Topic[]): HTMLDetailsElement {
  const rows = topics.map((t) =>
    el('tr', {}, [
      el('td', { text: t.topic }),
      el('td', { text: t.domain_label }),
      el('td', { class: 'num', text: unsigned(t.runs.v1.cosine_en_pl) }),
      el('td', { class: 'num', text: unsigned(t.runs.v2.cosine_en_pl) }),
    ]),
  )
  return el('details', { class: 'datatable' }, [
    el('summary', { text: 'Show data table' }),
    el('div', { class: 'tablewrap' }, [
      el('table', {}, [
        el('caption', { text: 'Cosine similarity of each topic’s English and Polish answer (LaBSE)' }),
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Topic' }),
            el('th', { scope: 'col', text: 'Domain' }),
            el('th', { scope: 'col', class: 'num', text: 'v1' }),
            el('th', { scope: 'col', class: 'num', text: 'v2' }),
          ]),
        ]),
        el('tbody', {}, rows),
      ]),
    ]),
  ])
}
