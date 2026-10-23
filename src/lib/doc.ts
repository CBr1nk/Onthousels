import type { JSONContent } from '@tiptap/react'
import type { NoteMode } from './types'

export function emptyDoc(mode: NoteMode): JSONContent {
  return mode === 'checklist'
    ? { type: 'doc', content: [{ type: 'taskList', content: [taskItem([], false)] }] }
    : { type: 'doc', content: [{ type: 'paragraph' }] }
}

function taskItem(inline: JSONContent[], checked: boolean): JSONContent {
  return {
    type: 'taskItem',
    attrs: { checked },
    content: [inline.length ? { type: 'paragraph', content: inline } : { type: 'paragraph' }],
  }
}

interface Line {
  inline: JSONContent[]
  checked: boolean
}

/** Flattens a document into its lines of inline content, splitting soft line breaks. */
function collectLines(node: JSONContent, checked = false, out: Line[] = []): Line[] {
  if (node.type === 'paragraph' || node.type === 'heading') {
    let current: JSONContent[] = []
    for (const child of node.content ?? []) {
      if (child.type === 'hardBreak') {
        out.push({ inline: current, checked })
        current = []
      } else {
        current.push(child)
      }
    }
    out.push({ inline: current, checked })
    return out
  }
  const itemChecked = node.type === 'taskItem' ? Boolean(node.attrs?.checked) : checked
  for (const child of node.content ?? []) collectLines(child, itemChecked, out)
  return out
}

const hasText = (line: Line) => line.inline.some(n => (n.text ?? '').trim() !== '')

export function toChecklist(doc: JSONContent): JSONContent {
  const lines = collectLines(doc).filter(hasText)
  if (!lines.length) return emptyDoc('checklist')
  return { type: 'doc', content: [{ type: 'taskList', content: lines.map(l => taskItem(l.inline, l.checked)) }] }
}

export function toText(doc: JSONContent): JSONContent {
  const lines = collectLines(doc).filter(hasText)
  if (!lines.length) return emptyDoc('text')
  return { type: 'doc', content: lines.map(l => ({ type: 'paragraph', content: l.inline })) }
}

export function plainText(node: JSONContent): string {
  if (node.text) return node.text
  return (node.content ?? []).map(plainText).join(' ')
}

export function isBlank(title: string, content: JSONContent): boolean {
  return title.trim() === '' && plainText(content).trim() === ''
}

/** Flips the n-th task item (pre-order, matching NoteRenderer's numbering). */
export function toggleTaskAt(doc: JSONContent, index: number): JSONContent {
  let seen = -1
  const walk = (node: JSONContent): JSONContent => {
    let next = node
    if (node.type === 'taskItem') {
      seen++
      if (seen === index) next = { ...node, attrs: { ...node.attrs, checked: !node.attrs?.checked } }
    }
    return next.content ? { ...next, content: next.content.map(walk) } : next
  }
  return walk(doc)
}

/** Small stable hash so each note keeps the same paper tone across renders. */
export function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return h >>> 0
}

export function countDone(node: JSONContent): number {
  const self = node.type === 'taskItem' && node.attrs?.checked ? 1 : 0
  return (node.content ?? []).reduce((sum, child) => sum + countDone(child), self)
}

/** Drops ticked items, along with anything nested under them. */
export function withoutDone(doc: JSONContent): JSONContent {
  const prune = (node: JSONContent): JSONContent | null => {
    if (node.type === 'taskItem' && node.attrs?.checked) return null
    if (!node.content) return node
    const content = node.content.map(prune).filter((n): n is JSONContent => n !== null)
    if (node.type === 'taskList' && !content.length) return null
    return { ...node, content }
  }
  const next = prune(doc)
  return next?.content?.length ? next : emptyDoc('checklist')
}

/** A checklist item on its own, with how deeply it's nested. Items nested under it follow it. */
export interface FlatTask {
  depth: number
  attrs: JSONContent['attrs']
  /** Its own text (everything but the items nested under it). */
  blocks: JSONContent[]
}

/** A checklist's items in reading order (the order they appear on screen). */
export function flattenTasks(doc: JSONContent): FlatTask[] {
  const out: FlatTask[] = []
  const walk = (list: JSONContent, depth: number) => {
    for (const item of list.content ?? []) {
      if (item.type !== 'taskItem') continue
      out.push({ depth, attrs: item.attrs, blocks: (item.content ?? []).filter(c => c.type !== 'taskList') })
      for (const child of item.content ?? []) if (child.type === 'taskList') walk(child, depth + 1)
    }
  }
  for (const node of doc.content ?? []) if (node.type === 'taskList') walk(node, 0)
  return out
}

/** The other way round: a checklist document from items in reading order. */
export function buildTasks(flat: FlatTask[]): JSONContent {
  const top: JSONContent[] = []
  const open: { depth: number; item: JSONContent }[] = []
  for (const f of flat) {
    const item: JSONContent = { type: 'taskItem', attrs: f.attrs, content: [...f.blocks] }
    while (open.length && open[open.length - 1].depth >= f.depth) open.pop()
    const parent = open[open.length - 1]?.item
    if (!parent) {
      top.push(item)
    } else {
      let list = parent.content!.find(c => c.type === 'taskList')
      if (!list) parent.content!.push((list = { type: 'taskList', content: [] }))
      list.content!.push(item)
    }
    open.push({ depth: f.depth, item })
  }
  return top.length ? { type: 'doc', content: [{ type: 'taskList', content: top }] } : emptyDoc('checklist')
}

const blankTask = (t: FlatTask) => t.blocks.every(b => plainText(b).trim() === '')

/**
 * Drops empty items left at the end of a checklist, keeping at least `keep` items (a saved list
 * keeps one, so it's still a list; a card shows none). Returns the same document if there's
 * nothing to drop, including for anything that isn't a checklist.
 */
export function withoutBlankEnd(doc: JSONContent, keep = 1): JSONContent {
  const flat = flattenTasks(doc)
  let end = flat.length
  while (end > keep && blankTask(flat[end - 1])) end--
  if (end === flat.length) return doc
  return end ? buildTasks(flat.slice(0, end)) : { type: 'doc', content: [] }
}
