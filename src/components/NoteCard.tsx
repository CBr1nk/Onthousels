import type { CSSProperties } from 'react'
import { hashId } from '../lib/doc'
import type { Label, Note } from '../lib/types'
import { TrashIcon } from './Icons'
import { NoteRenderer } from './NoteRenderer'

interface Props {
  note: Note
  labelsById: Map<string, Label>
  onOpen: () => void
  onToggleTask: (index: number) => void
  onDelete: () => void
}

export function NoteCard({ note, labelsById, onOpen, onToggleTask, onDelete }: Props) {
  // Each note gets its own paper stock and a barely-there tilt, stable across visits.
  const h = hashId(note.id)
  const style = {
    '--tilt': `${((h % 9) - 4) * 0.14}deg`,
  } as CSSProperties
  const tape = h % 5 === 0
  const labels = note.labelIds.map(id => labelsById.get(id)).filter((l): l is Label => Boolean(l))

  return (
    <article
      className={`card paper tone-${(h >> 4) % 5}${tape ? ' taped' : ''}`}
      style={style}
      tabIndex={0}
      aria-label={note.title || 'Untitled note'}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      {note.title && <h3 className="card-title">{note.title}</h3>}
      <div className="card-body">
        <NoteRenderer doc={note.content} onToggleTask={onToggleTask} />
      </div>
      {labels.length > 0 && (
        <footer className="chips">
          {labels.map(l => (
            <span key={l.id} className="chip">
              {l.name}
            </span>
          ))}
        </footer>
      )}
      <button
        type="button"
        className="icon-btn card-delete"
        aria-label="Delete note"
        title="Delete"
        onClick={e => {
          e.stopPropagation()
          onDelete()
        }}
      >
        <TrashIcon size={17} />
      </button>
    </article>
  )
}
