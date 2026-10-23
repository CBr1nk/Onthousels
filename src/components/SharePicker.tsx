import { useEffect, useRef } from 'react'
import type { Person } from '../lib/collab'
import { CheckIcon } from './Icons'

interface Props {
  /** Set when a friend shared this note: their name. Otherwise the note is this person's own. */
  ownerName?: string
  friends: Person[]
  selected: string[]
  onToggle: (userId: string, on: boolean) => void
  onLeave: () => void
  onClose: () => void
}

/** Who a note is shared with. Friends ticked here can open it and write in it too. */
export function SharePicker({ ownerName, friends, selected, onToggle, onLeave, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    // Defer so the click that opened the picker doesn't immediately close it.
    const id = window.setTimeout(() => document.addEventListener('pointerdown', onPointer))
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="popover paper"
      role="dialog"
      aria-label="Share"
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      {ownerName !== undefined ? (
        <>
          <p className="popover-note">{ownerName} shared this note with you. You can both write in it.</p>
          <button type="button" className="popover-item danger" onClick={onLeave}>
            Remove from my notes
          </button>
        </>
      ) : (
        <>
          <p className="popover-heading">Write together with</p>
          <ul className="popover-list">
            {friends.map(f => {
              const on = selected.includes(f.userId)
              return (
                <li key={f.userId}>
                  <button
                    type="button"
                    className="popover-item"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    autoFocus={f === friends[0]}
                    onClick={() => onToggle(f.userId, !on)}
                  >
                    <span className={on ? 'tick on' : 'tick'}>{on && <CheckIcon size={13} strokeWidth={2.2} />}</span>
                    {f.name}
                  </button>
                </li>
              )
            })}
            {friends.length === 0 && <li className="popover-empty">No friends yet. Add them from the menu, under Friends.</li>}
          </ul>
        </>
      )}
    </div>
  )
}
