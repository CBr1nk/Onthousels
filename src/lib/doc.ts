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
