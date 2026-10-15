import type { JSONContent } from '@tiptap/react'
import { countDone, plainText } from '../lib/doc'
import { NoteRenderer } from './NoteRenderer'

interface Props {
  content: JSONContent
  onOpen: () => void
  onToggleTask: (index: number) => void
  onClearDone: () => void
}

/** The one list that always stays at the top of the desk. */
export function PinnedTodo({ content, onOpen, onToggleTask, onClearDone }: Props) {
  const done = countDone(content)
  const empty = plainText(content).trim() === ''

  return (
    <section
      className="card paper pinned"
      tabIndex={0}
      aria-label="To do"
      onClick={onOpen}
      onKeyDown={e => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <header className="pinned-head">
        <h2 className="card-title">To do</h2>
        {done > 0 && (
          <button
            type="button"
            className="link-btn"
            onClick={e => {
              e.stopPropagation()
              onClearDone()
            }}
          >
            Clear {done} done
          </button>
        )}
      </header>
      {empty ? (
        <p className="pinned-empty">Nothing on the list. Tap to add something.</p>
      ) : (
        <div className="card-body">
          <NoteRenderer doc={content} onToggleTask={onToggleTask} />
        </div>
      )}
    </section>
  )
}
