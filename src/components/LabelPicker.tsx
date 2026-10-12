import { useEffect, useRef, useState } from 'react'
import type { Label } from '../lib/types'
import { CheckIcon, PlusIcon } from './Icons'

interface Props {
  labels: Label[]
  selected: string[]
  onToggle: (labelId: string, on: boolean) => void
  onCreate: (name: string) => Promise<Label | null>
  onClose: () => void
}

export function LabelPicker({ labels, selected, onToggle, onCreate, onClose }: Props) {
  const [query, setQuery] = useState('')
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

  const q = query.trim().toLowerCase()
  const shown = q ? labels.filter(l => l.name.toLowerCase().includes(q)) : labels
  const exact = labels.some(l => l.name.toLowerCase() === q)

  const create = async () => {
    const label = await onCreate(query)
    if (label && !selected.includes(label.id)) onToggle(label.id, true)
    setQuery('')
  }

  return (
    <div
      ref={ref}
      className="popover paper"
      role="dialog"
      aria-label="Labels"
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <input
        className="popover-input"
        autoFocus
        placeholder="Find or make a label"
        value={query}
        maxLength={50}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && q && !exact) {
            e.preventDefault()
            create()
          }
        }}
      />
      <ul className="popover-list">
        {shown.map(l => {
          const on = selected.includes(l.id)
          return (
            <li key={l.id}>
              <button type="button" className="popover-item" role="menuitemcheckbox" aria-checked={on} onClick={() => onToggle(l.id, !on)}>
                <span className={on ? 'tick on' : 'tick'}>{on && <CheckIcon size={13} strokeWidth={2.2} />}</span>
                {l.name}
              </button>
            </li>
          )
        })}
        {q && !exact && (
          <li>
            <button type="button" className="popover-item create" onClick={create}>
              <PlusIcon size={16} /> Create “{query.trim()}”
            </button>
          </li>
        )}
        {!q && labels.length === 0 && <li className="popover-empty">No labels yet. Type to make one.</li>}
      </ul>
    </div>
  )
}
