/**
 * A small, safe Markdown subset, used for two kinds of text:
 *   - Kasia's report and README, split into sections (see copy.ts);
 *   - the model's answers (headings, lists, bold / italic, simple tables).
 * Everything is built with DOM nodes and textContent; nothing goes through
 * innerHTML, so text from data files can never inject markup.
 */
export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string; lang: string }
  | { kind: 'table'; lines: string[] }
  | { kind: 'image'; alt: string; src: string }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' }

const LIST_ITEM = /^\s*([-*+•]|\d+[.)])\s+(.*)$/

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ kind: 'p', text: para.join(' ').trim() })
    para = []
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      flush()
      const body: string[] = []
      i += 1
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++])
      i += 1
      out.push({ kind: 'code', text: body.join('\n'), lang: fence[1] })
      continue
    }
    if (/^\s*$/.test(line)) {
      flush()
      i += 1
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (h) {
      flush()
      out.push({ kind: 'heading', level: h[1].length, text: h[2] })
      i += 1
      continue
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush()
      out.push({ kind: 'rule' })
      i += 1
      continue
    }
    if (/^\s*\|/.test(line)) {
      flush()
      const rows: string[] = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++])
      out.push({ kind: 'table', lines: rows })
      continue
    }
    const img = line.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/)
    if (img) {
      flush()
      out.push({ kind: 'image', alt: img[1], src: img[2] })
      i += 1
      continue
    }
    const li = line.match(LIST_ITEM)
    if (li) {
      flush()
      const ordered = /\d/.test(li[1])
      const items: string[] = []
      while (i < lines.length) {
        const m = lines[i].match(LIST_ITEM)
        if (m) {
          items.push(m[2])
          i += 1
        } else if (items.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += ` ${lines[i].trim()}` // wrapped continuation line
          i += 1
        } else break
      }
      out.push({ kind: 'list', ordered, items })
      continue
    }
    const q = line.match(/^\s*>\s?(.*)$/)
    if (q) {
      flush()
      out.push({ kind: 'quote', text: q[1] })
      i += 1
      continue
    }
    para.push(line.trim())
    i += 1
  }
  flush()
  return out
}

/** Optional link for “Figure 2” / “Table 1” references (they point at the report). */
export interface InlineOptions {
  referenceUrl?: string
}

// **bold**, *italic*, `code`, [text](https://…), bare https:// URLs, Figure N / Table N
const INLINE =
  /\*\*(.+?)\*\*|\*([^*\s](?:[^*]*?[^*\s])?)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+[^\s).,;:])|\b((?:Figure|Table) \d+)\b/g

export function renderInline(text: string, opts: InlineOptions = {}): DocumentFragment {
  const frag = document.createDocumentFragment()
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) frag.append(text.slice(last, at))
    if (m[1] !== undefined) {
      const strong = document.createElement('strong')
      strong.append(renderInline(m[1], opts))
      frag.append(strong)
    } else if (m[2] !== undefined) {
      const em = document.createElement('em')
      em.append(renderInline(m[2], opts))
      frag.append(em)
    } else if (m[3] !== undefined) {
      const code = document.createElement('code')
      code.textContent = m[3]
      frag.append(code)
    } else if (m[4] !== undefined && m[5] !== undefined) {
      frag.append(link(m[4], m[5]))
    } else if (m[6] !== undefined) {
      frag.append(link(m[6], m[6]))
    } else if (m[7] !== undefined) {
      frag.append(opts.referenceUrl ? link(m[7], opts.referenceUrl, 'Opens the figure in the report') : m[7])
    }
    last = at + m[0].length
  }
  if (last < text.length) frag.append(text.slice(last))
  return frag
}

function link(text: string, href: string, title?: string): HTMLAnchorElement {
  const a = document.createElement('a')
  a.href = href
  a.textContent = text
  if (title) a.title = title
  if (/^https?:/.test(href)) {
    a.target = '_blank'
    a.rel = 'noopener'
  }
  return a
}

function splitRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

export interface BlockOptions extends InlineOptions {
  /** heading level used for a Markdown "#" (the page outline continues below it) */
  baseHeading?: number
}

export function renderBlocks(blocks: Block[], opts: BlockOptions = {}): DocumentFragment {
  const frag = document.createDocumentFragment()
  const base = opts.baseHeading ?? 4
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading': {
        const level = Math.min(6, base + b.level - 1)
        const h = document.createElement(`h${level}` as 'h4')
        h.className = 'md-h'
        h.append(renderInline(b.text, opts))
        frag.append(h)
        break
      }
      case 'p': {
        const p = document.createElement('p')
        p.append(renderInline(b.text, opts))
        frag.append(p)
        break
      }
      case 'list': {
        const list = document.createElement(b.ordered ? 'ol' : 'ul')
        for (const item of b.items) {
          const li = document.createElement('li')
          li.append(renderInline(item, opts))
          list.append(li)
        }
        frag.append(list)
        break
      }
      case 'code': {
        const pre = document.createElement('pre')
        const code = document.createElement('code')
        code.textContent = b.text
        pre.append(code)
        frag.append(pre)
        break
      }
      case 'quote': {
        const q = document.createElement('blockquote')
        q.append(renderInline(b.text, opts))
        frag.append(q)
        break
      }
      case 'rule':
        frag.append(document.createElement('hr'))
        break
      case 'table': {
        const rows = b.lines.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)).map(splitRow)
        if (!rows.length) break
        const table = document.createElement('table')
        table.className = 'md-table'
        const thead = document.createElement('thead')
        const tr = document.createElement('tr')
        for (const c of rows[0]) {
          const th = document.createElement('th')
          th.append(renderInline(c, opts))
          tr.append(th)
        }
        thead.append(tr)
        const tbody = document.createElement('tbody')
        for (const r of rows.slice(1)) {
          const row = document.createElement('tr')
          for (const c of r) {
            const td = document.createElement('td')
            td.append(renderInline(c, opts))
            row.append(td)
          }
          tbody.append(row)
        }
        table.append(thead, tbody)
        const wrap = document.createElement('div')
        wrap.className = 'tablewrap'
        wrap.append(table)
        frag.append(wrap)
        break
      }
      case 'image':
        break // the site draws its own figures
    }
  }
  return frag
}

export function renderMarkdown(md: string, opts: BlockOptions = {}): DocumentFragment {
  return renderBlocks(parseBlocks(md), opts)
}
