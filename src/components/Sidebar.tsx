import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Label } from '../lib/types'
import { CheckIcon, LeaveIcon, NotesIcon, PencilIcon, PlusIcon, TagIcon, TrashIcon } from './Icons'

interface Props {
  user: User
  labels: Label[]
  counts: Map<string, number>
  total: number
  selected: string | null
  open: boolean
  onSelect: (labelId: string | null) => void
  onCreate: (name: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onSignOut: () => void
  onClose: () => void
}

export function Sidebar(props: Props) {
  const { user, labels, counts, total, selected, open, onSelect, onClose } = props
  const [editing, setEditing] = useState(false)
  const [newName, setNewName] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)

  const name = (user.user_metadata.full_name as string | undefined) ?? user.email ?? 'You'

  const pick = (id: string | null) => {
    onSelect(id)
    onClose()
  }

  return (
    <>
      <div className={`scrim${open ? ' show' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Labels">
        <nav>
          <button type="button" className={`nav-item${selected === null ? ' on' : ''}`} onClick={() => pick(null)}>
            <NotesIcon size={19} />
            <span className="nav-name">All notes</span>
            <span className="count">{total}</span>
          </button>

          <div className="nav-heading">
            <span>Labels</span>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setEditing(e => !e)
                setConfirming(null)
              }}
            >
              {editing ? 'Done' : 'Edit'}
            </button>
          </div>

          {editing && (
            <form
              className="label-new"
              onSubmit={e => {
                e.preventDefault()
                if (newName.trim()) props.onCreate(newName)
                setNewName('')
              }}
            >
              <PlusIcon size={17} />
              <input placeholder="New label" value={newName} maxLength={50} onChange={e => setNewName(e.target.value)} />
            </form>
          )}

          {labels.map(l =>
            editing ? (
              <div key={l.id} className="label-edit">
                <PencilIcon size={16} />
                <input
                  defaultValue={l.name}
                  maxLength={50}
                  aria-label={`Rename ${l.name}`}
                  onBlur={e => e.target.value.trim() !== l.name && props.onRename(l.id, e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                />
                {confirming === l.id ? (
                  <button type="button" className="link-btn danger" onClick={() => props.onDelete(l.id)}>
                    Delete?
                  </button>
                ) : (
                  <button type="button" className="icon-btn" aria-label={`Delete ${l.name}`} onClick={() => setConfirming(l.id)}>
                    <TrashIcon size={16} />
                  </button>
                )}
              </div>
            ) : (
              <button key={l.id} type="button" className={`nav-item${selected === l.id ? ' on' : ''}`} onClick={() => pick(l.id)}>
                <TagIcon size={18} />
                <span className="nav-name">{l.name}</span>
                <span className="count">{counts.get(l.id) ?? 0}</span>
              </button>
            ),
          )}

          {!editing && labels.length === 0 && (
            <p className="nav-hint">Labels gather related notes. Add them from a note, or tap Edit.</p>
          )}
          {editing && labels.length > 0 && (
            <p className="nav-hint">
              <CheckIcon size={13} /> Deleting a label keeps its notes.
            </p>
          )}
        </nav>

        <div className="me">
          <span className="me-initial">{name[0]?.toUpperCase()}</span>
          <span className="me-name">{name}</span>
          <button type="button" className="icon-btn" title="Sign out" aria-label="Sign out" onClick={props.onSignOut}>
            <LeaveIcon size={18} />
          </button>
        </div>
      </aside>
    </>
  )
}
