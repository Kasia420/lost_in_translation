/**
 * Types and loaders for the JSON files written by `python -m src.run site-data`
 * (site/public/data/). The export verifies every number against
 * results/results_table.csv; the site only reads these files and never types
 * a result by hand.
 */
export type Lang = 'en' | 'pl'
export type RunId = 'v1' | 'v2'
export type DomainId = 'contested_history' | 'literature' | 'social_norms'

export const LANGS: readonly Lang[] = ['en', 'pl']

export interface Answer {
  prompt_sent: string
  text: string
  words: number
  words_clean: number
  sentiment: number
  sentiment_chunked: number
  xlmr_tokens: number
  timestamp: string
  ends_mid_sentence?: boolean
  stop_reason?: string
  model_returned?: string
  output_tokens?: number
}

export interface RunEntry {
  answers: Record<Lang, Answer>
  cosine_en_pl: number
  similarity_to_wikipedia: {
    en_answer_en_wiki: number | null
    en_answer_pl_wiki: number | null
    pl_answer_pl_wiki: number | null
    pl_answer_en_wiki: number | null
  }
  native_pull: Record<Lang, number | null>
}

export interface WikiLead {
  title: string
  url: string
  lead: string
  sentiment: number
  sentiment_chunked: number
  xlmr_tokens: number
}

export interface Topic {
  id: string
  domain: DomainId
  domain_label: string
  topic: string
  prompt: Record<Lang, string>
  wikipedia: Record<Lang, WikiLead> | null
  runs: Record<RunId, RunEntry>
}

export interface ResultRow {
  run: string
  section: string
  measure: string
  subset: string
  A: string
  B: string | null
  n: number
  median_A: number | null
  median_B: number | null
  median_diff: number | null
  W: number | null
  p: number | null
  rank_biserial: number | null
  notes: string | null
}

export interface CloudPoint {
  id: string
  kind: 'answer' | 'wikipedia'
  run: RunId | null
  topic: string
  lang: Lang
  x: number
  y: number
  z: number
}

export interface Meta {
  schema_version: number
  source_commit: string | null
  title: string
  author: string
  repository: string
  runs: Record<
    RunId,
    {
      model: string
      temperature: number
      max_tokens: number
      length_instruction: Record<Lang, string> | null
      jitter_seed: number | null
    }
  >
  run_notes: Record<RunId, string>
  models: { embedding: string; sentiment: string; sentiment_polarity: string }
  domains: { id: DomainId; label: string }[]
  statistics: string
  projection: {
    method: string
    input: string
    n_points: number
    explained_variance_ratio: number[]
    scaling: string
    note: string
    max_abs_diff_recomputed_vs_stored_cosine: number
  }
  attribution: Record<string, string>
}

export interface SiteData {
  meta: Meta
  topics: Topic[]
  results: ResultRow[]
  points: CloudPoint[]
}

async function getJSON<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`)
  if (!res.ok) throw new Error(`Could not load data/${name} (HTTP ${res.status})`)
  return (await res.json()) as T
}

/** Load the files the page needs; `onProgress(done, total)` fires as each one arrives. */
export async function loadSiteData(onProgress?: (done: number, total: number) => void): Promise<SiteData> {
  const total = 4
  let done = 0
  const track = <T>(p: Promise<T>): Promise<T> =>
    p.then((value) => {
      done += 1
      onProgress?.(done, total)
      return value
    })
  const [meta, topics, results, emb] = await Promise.all([
    track(getJSON<Meta>('meta.json')),
    track(getJSON<Topic[]>('topics.json')),
    track(getJSON<ResultRow[]>('results.json')),
    track(getJSON<{ points: CloudPoint[] }>('embeddings3d.json')),
  ])
  return { meta, topics, results, points: emb.points }
}

export interface TatoebaPair {
  pair_no: number
  eng_id: string
  pol_id: string
  en: string
  pl: string
  sentiment_en: number
  sentiment_pl: number
  label_en: 'negative' | 'neutral' | 'positive'
  label_pl: 'negative' | 'neutral' | 'positive'
  xlmr_tokens_en: number
  xlmr_tokens_pl: number
}

export interface TatoebaData {
  source: string
  sentence_url: string
  pairs: TatoebaPair[]
}

let tatoebaPromise: Promise<TatoebaData> | null = null
/** The 1,000 Tatoeba pairs (342 KB): loaded only when the calibration chapter comes near. */
export function loadTatoeba(): Promise<TatoebaData> {
  tatoebaPromise ??= getJSON<TatoebaData>('tatoeba.json')
  return tatoebaPromise
}

export type ResultQuery = Pick<ResultRow, 'run' | 'section' | 'measure' | 'subset'>

/**
 * One row of results/results_table.csv. Throws when the row is missing or
 * ambiguous, so a chart can never fall back to a made-up number.
 */
export function findResult(rows: ResultRow[], q: ResultQuery): ResultRow {
  const hits = rows.filter(
    (r) => r.run === q.run && r.section === q.section && r.measure === q.measure && r.subset === q.subset,
  )
  if (hits.length !== 1) {
    throw new Error(`results.json: expected 1 row for ${JSON.stringify(q)}, found ${hits.length}`)
  }
  return hits[0]
}

/** Like findResult, for rows that must carry a value in `key`. */
export function resultValue(row: ResultRow, key: 'median_A' | 'median_B' | 'median_diff' | 'W' | 'p' | 'rank_biserial'): number {
  const v = row[key]
  if (v === null || Number.isNaN(v)) throw new Error(`results.json: ${row.section} / ${row.subset} has no ${key}`)
  return v
}
