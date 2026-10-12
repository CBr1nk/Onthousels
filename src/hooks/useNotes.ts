import { useCallback, useEffect, useRef, useState } from 'react'
import { uuid } from '../lib/id'
import { keepStorage, loadSnapshot, saveSnapshot } from '../lib/offline'
import { createOutbox } from '../lib/outbox'
import { supabase } from '../lib/supabase'
import type { Label, Note, NoteDraft } from '../lib/types'

interface NoteRow extends Omit<Note, 'labelIds'> {
  note_labels: { label_id: string }[]
}

const toNote = ({ note_labels, ...row }: NoteRow): Note => ({
  ...row,
  labelIds: note_labels.map(l => l.label_id),
})

const byName = (a: Label, b: Label) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

export function useNotes(userId: string, onError: (message: string) => void) {
  const [notes, setNotes] = useState<Note[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(0)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [stalled, setStalled] = useState(false)

  const notesRef = useRef(notes)
  notesRef.current = notes
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  // Something is on the desk (from this device's copy or the server), so a failed fetch needn't complain.
  const hasData = useRef(false)
  // The device's copy has been read, so writing it back can't clobber it with an empty desk.
  const snapshotRead = useRef(false)

  // Every write goes through here: kept on the device, sent in order, retried while offline.
  const [outbox] = useState(() =>
    createOutbox(userId, {
      onChange: (n, s) => {
        setPending(n)
        setStalled(s)
      },
      onRejected: () => onErrorRef.current('Something didn’t save. Check your connection and try again.'),
    }),
  )

  const load = useCallback(async () => {
    // Local changes go first; until they're in, the server copy would undo them on screen.
    const sent = await outbox.flush()
    if (!sent) {
      if (!hasData.current) onErrorRef.current('Couldn’t reach your notes. Check your connection.')
      setLoading(false)
      return
    }
    const before = outbox.pushes()
    const [n, l] = await Promise.all([
      supabase
        .from('notes')
        .select('id, title, content, mode, created_at, updated_at, note_labels(label_id)')
        .order('created_at', { ascending: false }),
      supabase.from('labels').select('id, name'),
    ])
    if (n.error || l.error) {
      console.error(n.error ?? l.error)
      if (!hasData.current) onErrorRef.current('Couldn’t reach your notes. Check your connection.')
    } else if (outbox.pushes() === before) {
      // (If a write was made mid-fetch, this copy may predate it; the next load catches up.)
      setNotes((n.data as NoteRow[]).map(toNote))
      setLabels((l.data as Label[]).sort(byName))
      hasData.current = true
    }
    setLoading(false)
  }, [outbox])

  useEffect(() => {
    let live = true
    keepStorage()
    // Open on this device's copy straight away, then catch up with the server.
    loadSnapshot(userId)
      .then(s => {
        if (!live || !s || hasData.current) return
        setNotes(s.notes)
        setLabels(s.labels)
        hasData.current = true
        setLoading(false)
      })
      .catch(console.error)
      .finally(() => {
        snapshotRead.current = true
        if (live) load()
      })

    // Pick up changes made on another device when returning to the tab, and send
    // anything written offline once the connection is back.
    const onVisible = () => document.visibilityState === 'visible' && load()
    const onOnline = () => {
      setOnline(true)
      load()
    }
    const onOffline = () => setOnline(false)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      outbox.dispose()
    }
  }, [userId, load, outbox])

  // Keep the device's copy in step with the desk.
  useEffect(() => {
    if (!snapshotRead.current) return
    saveSnapshot(userId, { notes, labels }).catch(console.error)
  }, [userId, notes, labels])

  const saveNote = useCallback(
    (draft: NoteDraft) => {
      const now = new Date().toISOString()
      setNotes(prev => {
        const i = prev.findIndex(n => n.id === draft.id)
        if (i === -1) return [{ ...draft, labelIds: [], created_at: now, updated_at: now }, ...prev]
        const next = [...prev]
        next[i] = { ...next[i], ...draft, updated_at: now }
        return next
      })
      const { id, title, content, mode } = draft
      outbox.push({ kind: 'upsertNote', row: { id, title, content, mode } })
    },
    [outbox],
  )

  /** Deletes immediately and returns an undo function that restores the note and its labels. */
  const deleteNote = useCallback(
    (id: string) => {
      const note = notesRef.current.find(n => n.id === id)
      setNotes(prev => prev.filter(n => n.id !== id))
      outbox.push({ kind: 'deleteNote', id })
      return () => {
        if (!note) return
        setNotes(prev => [note, ...prev].sort((a, b) => b.created_at.localeCompare(a.created_at)))
        const { labelIds, ...row } = note
        outbox.push({ kind: 'insertNote', row })
        if (labelIds.length) {
          outbox.push({ kind: 'insertNoteLabels', rows: labelIds.map(label_id => ({ note_id: id, label_id })) })
        }
      }
    },
    [outbox],
  )

  const toggleNoteLabel = useCallback(
    (noteId: string, labelId: string, on: boolean) => {
      setNotes(prev =>
        prev.map(n => {
          if (n.id !== noteId) return n
          const rest = n.labelIds.filter(l => l !== labelId)
          return { ...n, labelIds: on ? [...rest, labelId] : rest }
        }),
      )
      outbox.push({ kind: on ? 'addNoteLabel' : 'removeNoteLabel', noteId, labelId })
    },
    [outbox],
  )

  const createLabel = useCallback(
    async (rawName: string): Promise<Label | null> => {
      const name = rawName.trim().slice(0, 50)
      if (!name) return null
      const existing = labels.find(l => l.name.toLowerCase() === name.toLowerCase())
      if (existing) return existing
      // No need to wait for the server: the outbox sends this before any note is filed under it.
      const label = { id: uuid(), name }
      setLabels(prev => [...prev, label].sort(byName))
      outbox.push({ kind: 'insertLabel', label })
      return label
    },
    [labels, outbox],
  )

  const renameLabel = useCallback(
    (id: string, rawName: string) => {
      const name = rawName.trim().slice(0, 50)
      if (!name || labels.some(l => l.id !== id && l.name.toLowerCase() === name.toLowerCase())) return
      setLabels(prev => prev.map(l => (l.id === id ? { ...l, name } : l)).sort(byName))
      outbox.push({ kind: 'updateLabel', id, name })
    },
    [labels, outbox],
  )

  const deleteLabel = useCallback(
    (id: string) => {
      setLabels(prev => prev.filter(l => l.id !== id))
      setNotes(prev => prev.map(n => ({ ...n, labelIds: n.labelIds.filter(l => l !== id) })))
      outbox.push({ kind: 'deleteLabel', id })
    },
    [outbox],
  )

  return {
    notes,
    labels,
    loading,
    /** Writes not yet on the server. */
    pending,
    /** No connection, or writes are failing for want of one. */
    offline: !online || stalled,
    saveNote,
    deleteNote,
    toggleNoteLabel,
    createLabel,
    renameLabel,
    deleteLabel,
  }
}
