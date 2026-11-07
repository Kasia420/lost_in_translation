import { gsap } from 'gsap'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { CloudPoint, Lang, Meta, RunId, Topic } from '../lib/data'
import { percent, unsigned } from '../lib/format'
import { cssVar, el, hexToRgb } from '../lib/dom'

/*
 * Points are drawn as round sprites by a tiny shader. Colours are written as
 * sRGB values and output unchanged, so they match the CSS tokens exactly.
 */
const VERT = /* glsl */ `
attribute vec3 aColor;
uniform float uSize;
uniform float uPixelRatio;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * uPixelRatio;
}`

const FRAG = /* glsl */ `
uniform float uHollow;
uniform float uOpacity;
uniform float uGlow;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float core = 1.0 - smoothstep(0.22, 0.26, d);
  if (uHollow > 0.5) core *= smoothstep(0.13, 0.16, d);
  float halo = (1.0 - smoothstep(0.08, 0.5, d)) * 0.28 * uGlow;
  gl_FragColor = vec4(vColor, max(core, halo) * uOpacity);
}`

const SPRITE_PX = 24 // sprite box; the dot inside is about 11 px across
const HOVER_PX = 18

interface Slot {
  topic: Topic
  lang: Lang
  kind: 'answer' | 'wikipedia'
}

export function mountCloud(
  root: HTMLElement,
  opts: { topics: Topic[]; points: CloudPoint[]; meta: Meta; reducedMotion: boolean; direction: string },
): void {
  let run: RunId = 'v2'

  // ---- DOM ----
  const runSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Run' })
  const runButtons = new Map<RunId, HTMLButtonElement>()
  for (const r of ['v2', 'v1'] as const) {
    const b = el('button', { type: 'button', text: `Answers ${r}`, 'aria-pressed': String(r === run) })
    b.addEventListener('click', () => setRun(r))
    runButtons.set(r, b)
    runSeg.append(b)
  }
  const wikiBox = el('input', { type: 'checkbox' })
  const wikiToggle = el('label', { class: 'toggle' }, [wikiBox, 'Show Wikipedia leads'])
  const pauseBtn = el('button', {
    class: 'chip',
    type: 'button',
    'aria-pressed': String(opts.reducedMotion),
    text: 'Pause rotation',
  })
  const controlsRow = el('div', { class: 'chart__controls' }, [runSeg, wikiToggle, pauseBtn])
  const stage = el('div', {
    class: 'cloud__stage',
    role: 'img',
    'aria-label':
      '3D map of the answers: each English answer and its Polish counterpart are joined by a thread. ' +
      'The table below lists the same cosine values.',
  })
  const tooltip = el('div', { class: 'tooltip', 'aria-hidden': 'true' })
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
      'Hover a point for the cosine similarity used in the study.',
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
  stage.append(renderer.domElement, tooltip)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.enableZoom = false // never trap the page scroll
  controls.rotateSpeed = 0.6
  controls.autoRotate = !opts.reducedMotion
  controls.autoRotateSpeed = 0.7
  // let vertical swipes scroll the page on touch screens; horizontal drags rotate
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
  const answerPos = new Float32Array(pos.v2)
  const wikiPos = new Float32Array(wikiSlots.length * 3)
  wikiSlots.forEach((s, i) => {
    const p = need(`wiki:${s.topic.id}:${s.lang}`)
    wikiPos.set([p.x, p.y, p.z], i * 3)
  })

  const rgb = { en: hexToRgb(cssVar('--en')), pl: hexToRgb(cssVar('--pl')) }
  const colours = (slots: Slot[]) => {
    const c = new Float32Array(slots.length * 3)
    slots.forEach((s, i) => c.set(rgb[s.lang], i * 3))
    return c
  }

  const material = (hollow: boolean) =>
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uSize: { value: SPRITE_PX },
        uPixelRatio: { value: renderer.getPixelRatio() },
        uHollow: { value: hollow ? 1 : 0 },
        uOpacity: { value: hollow ? 0 : 1 },
        uGlow: { value: opts.direction === 'orbit' ? 1 : 0 },
      },
    })

  const answerGeom = new THREE.BufferGeometry()
  answerGeom.setAttribute('position', new THREE.BufferAttribute(answerPos, 3))
  answerGeom.setAttribute('aColor', new THREE.BufferAttribute(colours(answerSlots), 3))
  const answerMat = material(false)
  const answers = new THREE.Points(answerGeom, answerMat)

  const wikiGeom = new THREE.BufferGeometry()
  wikiGeom.setAttribute('position', new THREE.BufferAttribute(wikiPos, 3))
  wikiGeom.setAttribute('aColor', new THREE.BufferAttribute(colours(wikiSlots), 3))
  const wikiMat = material(true)
  const wiki = new THREE.Points(wikiGeom, wikiMat)
  wiki.visible = false

  // threads between each topic's EN and PL answer (slots are ordered en, pl per topic)
  const linePos = new Float32Array(opts.topics.length * 6)
  const lineGeom = new THREE.BufferGeometry()
  lineGeom.setAttribute('position', new THREE.BufferAttribute(linePos, 3))
  const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(cssVar('--text-3')), transparent: true, opacity: 0.45 })
  const lines = new THREE.LineSegments(lineGeom, lineMat)
  const writeLines = () => {
    linePos.set(answerPos)
    lineGeom.attributes.position.needsUpdate = true
  }
  writeLines() // en/pl pairs are consecutive, which is exactly the LineSegments layout

  scene.add(lines, answers, wiki)

  let radius = 0
  for (const arr of [pos.v1, pos.v2, wikiPos]) {
    for (let i = 0; i < arr.length; i += 3) radius = Math.max(radius, Math.hypot(arr[i], arr[i + 1], arr[i + 2]))
  }

  const resize = () => {
    const w = stage.clientWidth || 800
    const h = Math.round(Math.min(560, Math.max(360, w * 0.6)))
    renderer.setSize(w, h)
    camera.aspect = w / h
    const fit = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))
    const dist = (camera.aspect < 1 ? fit / camera.aspect : fit) * 1.08
    camera.position.setLength(dist || 4)
    if (camera.position.lengthSq() === 0) camera.position.set(0, 0, dist)
    camera.updateProjectionMatrix()
  }
  camera.position.set(0, 0, 4)
  resize()
  new ResizeObserver(resize).observe(stage)

  // ---- render loop, only while on screen ----
  let raf = 0
  const loop = () => {
    raf = requestAnimationFrame(loop)
    controls.update()
    renderer.render(scene, camera)
  }
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && !raf) loop()
    else if (!entry.isIntersecting && raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
  }).observe(stage)

  // ---- hover: nearest point on screen ----
  const v = new THREE.Vector3()
  const pick = (clientX: number, clientY: number): { slot: Slot; sx: number; sy: number } | null => {
    const rect = renderer.domElement.getBoundingClientRect()
    let best: { slot: Slot; sx: number; sy: number; d: number } | null = null
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
    if (wiki.visible && wikiMat.uniforms.uOpacity.value > 0.5) scan(wikiSlots, wikiPos)
    return best
  }

  const showTip = (hit: { slot: Slot; sx: number; sy: number }) => {
    const { slot } = hit
    const lang = slot.lang === 'en' ? 'English' : 'Polish'
    if (slot.kind === 'answer') {
      const r = slot.topic.runs[run]
      tooltip.replaceChildren(
        el('div', { class: 'tt__vals' }, [unsigned(r.cosine_en_pl), el('small', { text: 'cosine EN–PL' })]),
        el('div', { class: 'tt__label', text: slot.topic.topic }),
        el('div', { class: 'tt__meta', text: `${lang} answer · ${run} · ${r.answers[slot.lang].words} words` }),
      )
    } else {
      const w = slot.topic.wikipedia?.[slot.lang]
      tooltip.replaceChildren(
        el('div', { class: 'tt__vals', text: 'Wikipedia lead' }),
        el('div', { class: 'tt__label', text: w?.title ?? slot.topic.topic }),
        el('div', { class: 'tt__meta', text: `${lang} Wikipedia · ${slot.topic.topic}` }),
      )
    }
    tooltip.style.left = `${Math.min(Math.max(hit.sx, 120), stage.clientWidth - 120)}px`
    tooltip.style.top = `${hit.sy}px`
    tooltip.style.transform = hit.sy < 110 ? 'translate(-50%, 18px)' : ''
    tooltip.classList.add('is-on')
  }

  renderer.domElement.addEventListener('pointermove', (e) => {
    const hit = pick(e.clientX, e.clientY)
    if (hit) showTip(hit)
    else tooltip.classList.remove('is-on')
  })
  renderer.domElement.addEventListener('pointerleave', () => tooltip.classList.remove('is-on'))

  // ---- controls ----
  const morph = { t: 0 } // 0 = v2 positions, 1 = v1 positions
  function setRun(r: RunId) {
    run = r
    for (const [k, b] of runButtons) b.setAttribute('aria-pressed', String(k === r))
    tooltip.classList.remove('is-on')
    gsap.to(morph, {
      t: r === 'v1' ? 1 : 0,
      duration: opts.reducedMotion ? 0 : 1.4,
      ease: 'power2.inOut',
      onUpdate: () => {
        for (let i = 0; i < answerPos.length; i++) answerPos[i] = pos.v2[i] + (pos.v1[i] - pos.v2[i]) * morph.t
        answerGeom.attributes.position.needsUpdate = true
        writeLines()
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
    controls.autoRotate = !controls.autoRotate
    pauseBtn.setAttribute('aria-pressed', String(!controls.autoRotate))
  })

  window.addEventListener('directionchange', (e) => {
    const direction = (e as CustomEvent<string>).detail
    lineMat.color.set(cssVar('--text-3'))
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
