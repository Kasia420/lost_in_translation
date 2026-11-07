/**
 * All narrative text on the site is Kasia's, read at build time from
 *   docs/portfolio_report.md  (chapters, results, interpretation, limitations)
 *   README.md                 (AI assistance)
 * and shown verbatim. Lookups throw when a section or paragraph is missing,
 * so a restructured report fails loudly instead of leaving a silent gap.
 */
import readmeRaw from '../../../README.md?raw'
import reportRaw from '../../../docs/portfolio_report.md?raw'
import { parseBlocks, type Block } from './markdown'

export const REPORT_URL = 'https://github.com/Kasia420/lost_in_translation/blob/main/docs/portfolio_report.md'
export const README_URL = 'https://github.com/Kasia420/lost_in_translation#readme'

type Doc = 'report' | 'readme'

const normalise = (s: string) =>
  s
    .replace(/^\d+(\.\d+)*\.?\s+/, '') // "3.2 Sentiment …" -> "Sentiment …"
    .trim()
    .toLowerCase()

function sections(md: string): Map<string, Block[]> {
  const map = new Map<string, Block[]>()
  let current: Block[] = []
  map.set('', current)
  for (const b of parseBlocks(md)) {
    if (b.kind === 'heading') {
      current = []
      map.set(normalise(b.text), current)
    } else current.push(b)
  }
  return map
}

const DOCS: Record<Doc, { raw: string; sections: Map<string, Block[]> }> = {
  report: { raw: reportRaw, sections: sections(reportRaw) },
  readme: { raw: readmeRaw, sections: sections(readmeRaw) },
}

function section(doc: Doc, heading: string): Block[] {
  const s = DOCS[doc].sections.get(normalise(heading))
  if (!s) throw new Error(`copy: no section “${heading}” in ${doc}`)
  return s
}

/** Captions and notes that belong to the report's own figures and table. */
const isFigureText = (t: string) => /^\*(Figure \d+|Notes)\.\*/.test(t) || /^\*\*Table \d+\.\*\*/.test(t)

/** Body paragraphs of a section (figure captions and table notes left out). */
export function paragraphs(doc: Doc, heading: string): string[] {
  const out = section(doc, heading)
    .filter((b): b is Extract<Block, { kind: 'p' }> => b.kind === 'p')
    .map((b) => b.text)
    .filter((t) => !isFigureText(t))
  if (!out.length) throw new Error(`copy: section “${heading}” in ${doc} has no paragraphs`)
  return out
}

/** The paragraph that opens with a bold lead-in, e.g. "**Design.** …". */
export function leadParagraph(doc: Doc, heading: string, lead: string): string {
  const hit = section(doc, heading).find((b) => b.kind === 'p' && b.text.startsWith(`**${lead}**`))
  if (!hit || hit.kind !== 'p') throw new Error(`copy: no “**${lead}**” paragraph in ${doc} / ${heading}`)
  return hit.text
}

/** One bullet of a list, found by its opening, e.g. "**H1". */
export function listItem(doc: Doc, heading: string, startsWith: string): string {
  for (const b of section(doc, heading)) {
    if (b.kind !== 'list') continue
    const item = b.items.find((i) => i.startsWith(startsWith))
    if (item) return item
  }
  throw new Error(`copy: no list item “${startsWith}…” in ${doc} / ${heading}`)
}

export function codeBlock(doc: Doc, heading: string): string {
  const hit = section(doc, heading).find((b) => b.kind === 'code')
  if (!hit || hit.kind !== 'code') throw new Error(`copy: no code block in ${doc} / ${heading}`)
  return hit.text
}

/** Paragraphs of a section that come after the code block (e.g. the notes after "Commands."). */
export function paragraphsAfterCode(doc: Doc, heading: string): string[] {
  const s = section(doc, heading)
  const at = s.findIndex((b) => b.kind === 'code')
  return s
    .slice(at + 1)
    .filter((b): b is Extract<Block, { kind: 'p' }> => b.kind === 'p')
    .map((b) => b.text)
}

/** Title line of the report ("# …") and the byline under it, verbatim. */
export function reportTitle(): string {
  const m = reportRaw.match(/^#\s+(.+)$/m)
  if (!m) throw new Error('copy: report has no title')
  return m[1].trim()
}

export function reportByline(): string {
  const m = reportRaw.match(/^\*\*Katarzyna Frąckowiak\*\*.*$/m)
  if (!m) throw new Error('copy: report has no byline')
  return m[0].trim()
}
