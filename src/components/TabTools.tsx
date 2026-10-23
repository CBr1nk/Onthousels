import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import type { Person } from '../lib/collab'
import type { NoteMode } from '../lib/types'
import { CheckIcon, ChecklistIcon, ChevronDownIcon, ChevronUpIcon, TextIcon, TrashIcon } from './Icons'

/** Closes a popover on a tap outside it, or on Escape. */
function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    // Defer so the click that opened the popover doesn't immediately close it.
    const id = window.setTimeout(() => document.addEventListener('pointerdown', onPointer))
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [ref, onClose])
}

const escapeCloses = (onClose: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    onClose()
  }
}

interface NewTabProps {
  /** What's being made, e.g. "tab" or "page". */
  noun: string
  /** Friends it could be shared with; leave out where sharing doesn't apply (a note's pages). */
  friends?: Person[]
  /** Start with every friend ticked. */
  shareByDefault?: boolean
  onAdd: (name: string, mode: NoteMode, friendIds: string[]) => void
  onClose: () => void
}

/** Name a new tab or page, choose a list or a note, and who (if anyone) shares it. */
export function NewTabForm({ noun, friends, shareByDefault, onAdd, onClose }: NewTabProps) {
  const ref = useRef<HTMLFormElement>(null)
  const [name, setName] = useState('')
  const [mode, setMode] = useState<NoteMode>('checklist')
  const [picked, setPicked] = useState<string[]>(() => (shareByDefault && friends ? friends.map(f => f.userId) : []))
  useDismiss(ref, onClose)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) onAdd(name.trim(), mode, picked)
  }

  return (
    <form ref={ref} className="popover paper below new-tab" aria-label={`New ${noun}`} onSubmit={submit} onKeyDown={escapeCloses(onClose)}>
      <input
        className="popover-input"
        autoFocus
        placeholder={`${noun[0].toUpperCase()}${noun.slice(1)} name`}
        maxLength={40}
        value={name}
        onChange={e => setName(e.target.value)}
      />
      <div className="segmented new-tab-type" role="radiogroup" aria-label={`${noun} type`}>
        <button type="button" role="radio" aria-checked={mode === 'checklist'} onClick={() => setMode('checklist')}>
          <ChecklistIcon size={16} />
          List
        </button>
        <button type="button" role="radio" aria-checked={mode === 'text'} onClick={() => setMode('text')}>
          <TextIcon size={16} />
          Note
        </button>
      </div>
      {friends && (
        <>
          <p className="popover-heading">Share with</p>
          <ul className="popover-list">
            {friends.map(f => {
              const on = picked.includes(f.userId)
              return (
                <li key={f.userId}>
                  <button
                    type="button"
                    className="popover-item"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    onClick={() => setPicked(p => (on ? p.filter(id => id !== f.userId) : [...p, f.userId]))}
                  >
                    <span className={on ? 'tick on' : 'tick'}>{on && <CheckIcon size={13} strokeWidth={2.2} />}</span>
                    {f.name}
                  </button>
                </li>
              )
            })}
            {friends.length === 0 && <li className="popover-empty">Just you. Add friends from the menu to share {noun}s.</li>}
          </ul>
        </>
      )}
      <button type="submit" className="btn-primary new-tab-add" disabled={!name.trim()}>
        Add {noun}
      </button>
    </form>
  )
}

export interface ArrangeItem {
  id: string
  name: string
  /** A friend's tab is only taken off this person's desk, not deleted. */
  removeOnly?: boolean
}

interface ArrangeProps {
  /** "Tabs" or "Pages", for the heading. */
  heading: string
  items: ArrangeItem[]
  onRename: (id: string, name: string) => void
  /** The items' ids in their new order. */
  onReorder: (ids: string[]) => void
  onDelete: (item: ArrangeItem) => void
  onClose: () => void
}

/** Rename, reorder and delete tabs (or a note's pages). */
export function ArrangeTabs({ heading, items, onRename, onReorder, onDelete, onClose }: ArrangeProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  useDismiss(ref, onClose)

  const move = (i: number, by: -1 | 1) => {
    const ids = items.map(t => t.id)
    ;[ids[i], ids[i + by]] = [ids[i + by], ids[i]]
    onReorder(ids)
  }

  return (
    <div ref={ref} className="popover paper below arrange" role="dialog" aria-label={`Arrange ${heading.toLowerCase()}`} onKeyDown={escapeCloses(onClose)}>
      <p className="popover-heading">{heading}</p>
      <ul className="popover-list">
        {items.map((t, i) => (
          <li key={t.id} className="arrange-row">
            <input
              defaultValue={t.name}
              maxLength={40}
              aria-label={`Rename ${t.name}`}
              onBlur={e => e.target.value.trim() && e.target.value.trim() !== t.name && onRename(t.id, e.target.value)}
              onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <button type="button" className="icon-btn" aria-label={`Move ${t.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              <ChevronUpIcon size={17} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Move ${t.name} down`}
              disabled={i === items.length - 1}
              onClick={() => move(i, 1)}
            >
              <ChevronDownIcon size={17} />
            </button>
            {confirming === t.id ? (
              <button type="button" className="link-btn danger" onClick={() => onDelete(t)}>
                {t.removeOnly ? 'Remove?' : 'Delete?'}
              </button>
            ) : (
              <button
                type="button"
                className="icon-btn"
                aria-label={`${t.removeOnly ? 'Remove' : 'Delete'} ${t.name}`}
                onClick={() => setConfirming(t.id)}
              >
                <TrashIcon size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
