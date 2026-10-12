import type { ReactNode } from 'react'
import type { JSONContent } from '@tiptap/react'
import { CheckIcon } from './Icons'

interface Ctx {
  taskIndex: number
  onToggleTask?: (index: number) => void
}

function renderText(node: JSONContent, key: number): ReactNode {
  let out: ReactNode = node.text
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') out = <strong>{out}</strong>
    else if (mark.type === 'italic') out = <em>{out}</em>
    else if (mark.type === 'underline') out = <u>{out}</u>
    else if (mark.type === 'strike') out = <s>{out}</s>
  }
  return <span key={key}>{out}</span>
}

function renderNode(node: JSONContent, key: number, ctx: Ctx): ReactNode {
  const kids = () => (node.content ?? []).map((child, i) => renderNode(child, i, ctx))

  switch (node.type) {
    case 'text':
      return renderText(node, key)
    case 'hardBreak':
      return <br key={key} />
    case 'paragraph':
    case 'heading':
      return <p key={key}>{node.content?.length ? kids() : <br />}</p>
    case 'bulletList':
      return <ul key={key}>{kids()}</ul>
    case 'orderedList':
      return (
        <ol key={key} start={node.attrs?.start ?? 1}>
          {kids()}
        </ol>
      )
    case 'listItem':
      return <li key={key}>{kids()}</li>
    case 'taskList':
      return (
        <ul key={key} className="tasks">
          {kids()}
        </ul>
      )
    case 'taskItem': {
      const index = ctx.taskIndex++ // pre-order numbering, mirrored by toggleTaskAt
      const checked = Boolean(node.attrs?.checked)
      return (
        <li key={key} className={checked ? 'task done' : 'task'}>
          <button
            type="button"
            role="checkbox"
            aria-checked={checked}
            aria-label={checked ? 'Mark as not done' : 'Mark as done'}
            className="tick"
            onClick={e => {
              e.stopPropagation()
              ctx.onToggleTask?.(index)
            }}
          >
            {checked && <CheckIcon size={14} strokeWidth={2.2} />}
          </button>
          <div className="task-body">{kids()}</div>
        </li>
      )
    }
    default:
      return <div key={key}>{kids()}</div>
  }
}

export function NoteRenderer({
  doc,
  onToggleTask,
}: {
  doc: JSONContent
  onToggleTask?: (index: number) => void
}) {
  // Trailing empty paragraphs only add blank space on a card.
  const blocks = [...(doc.content ?? [])]
  while (blocks.length && blocks[blocks.length - 1].type === 'paragraph' && !blocks[blocks.length - 1].content?.length) {
    blocks.pop()
  }
  const ctx: Ctx = { taskIndex: 0, onToggleTask }
  return <div className="prose">{blocks.map((b, i) => renderNode(b, i, ctx))}</div>
}
