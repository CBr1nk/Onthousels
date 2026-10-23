import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { uuid } from '../lib/id'
import { keepStorage, loadSnapshot, saveSnapshot, type Snapshot } from '../lib/offline'
import { createOutbox } from '../lib/outbox'
import { supabase } from '../lib/supabase'
import type { Friend, FriendshipRow, Label, Note, NoteDraft, Space } from '../lib/types'

type NoteFields = Omit<Note, 'labelIds' | 'shares'>

interface NoteRow extends NoteFields {
  note_labels: { label_id: string }[]
  note_shares: { user_id: string; space: Space }[]
}

const NOTE_COLUMNS = 'id, user_id, title, content, mode, space, created_at, updated_at, note_labels(label_id), note_shares(user_id, space)'
const FRIEND_COLUMNS = 'id, requester_id, requester_email, addressee_email, addressee_id, status, requester_alias, addressee_alias, created_at'

const toNote =
  (me: string) =>
  ({ note_labels, note_shares, ...row }: NoteRow): Note => {
    const mine = row.user_id === me
    return {
      ...row,
      // A shared note sits wherever the friend it was shared with keeps it.
      space: mine ? row.space : (note_shares.find(s => s.user_id === me)?.space ?? row.space),
      labelIds: note_labels.map(l => l.label_id),
      shares: mine ? note_shares.map(s => s.user_id) : [],
    }
  }

const toFriend =
  (me: string) =>
  (r: FriendshipRow): Friend =>
    r.requester_id === me
      ? { id: r.id, userId: r.addressee_id, email: r.addressee_email, name: r.requester_alias, status: r.status, incoming: false }
      : { id: r.id, userId: r.requester_id, email: r.requester_email, name: r.addressee_alias, status: r.status, incoming: true }

/** Copies kept by an earlier version have no spaces, owners or friends. */
const upgrade = (userId: string, s: Snapshot): Required<Snapshot> => ({
  notes: s.notes.map(n => ({ ...n, user_id: n.user_id ?? userId, space: n.space ?? 'personal', shares: n.shares ?? [] })),
  labels: s.labels.map(l => ({ ...l, space: l.space ?? 'personal' })),
  friendships: s.friendships ?? [],
})

const byName = (a: Label, b: Label) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

export function useNotes(userId: string, onError: (message: string) => void) {
  const [notes, setNotes] = useState<Note[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [friendships, setFriendships] = useState<FriendshipRow[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(0)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [stalled, setStalled] = useState(false)

  const notesRef = useRef(notes)
  notesRef.current = notes
  const friendshipsRef = useRef(friendships)
  friendshipsRef.current = friendships
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
    const [n, l, f] = await Promise.all([
      supabase.from('notes').select(NOTE_COLUMNS).order('created_at', { ascending: false }),
      supabase.from('labels').select('id, name, space'),
      supabase.from('friendships').select(FRIEND_COLUMNS).order('created_at'),
    ])
    if (n.error || l.error || f.error) {
      console.error(n.error ?? l.error ?? f.error)
      if (!hasData.current) onErrorRef.current('Couldn’t reach your notes. Check your connection.')
    } else if (outbox.pushes() === before) {
      // (If a write was made mid-fetch, this copy may predate it; the next load catches up.)
      setNotes((n.data as NoteRow[]).map(toNote(userId)))
      setLabels((l.data as Label[]).sort(byName))
      setFriendships(f.data as FriendshipRow[])
      hasData.current = true
    }
    setLoading(false)
  }, [outbox, userId])

  const loadFriends = useCallback(async () => {
    const { data, error } = await supabase.from('friendships').select(FRIEND_COLUMNS).order('created_at')
    if (error) console.error(error)
    else setFriendships(data as FriendshipRow[])
  }, [])

  useEffect(() => {
    let live = true
    keepStorage()
    // Open on this device's copy straight away, then catch up with the server.
    loadSnapshot(userId)
      .then(saved => {
        if (!live || !saved || hasData.current) return
        const s = upgrade(userId, saved)
        setNotes(s.notes)
        setLabels(s.labels)
        setFriendships(s.friendships)
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

  // Live news from the server: a friend editing a shared note, a note shared or unshared,
  // a friend request. The channel only carries this person's own news (see supabase/schema.sql).
  useEffect(() => {
    let live = true
    let channel: RealtimeChannel | null = null
    let joined = false
    let timer: number | undefined
    const refresh = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(load, 300)
    }

    const patch = (row: NoteFields) => {
      // Our own newer edit is still on its way; this would only rewind it.
      if (outbox.pendingFor(row.id)) return
      // A note new to this device comes with labels and shares the broadcast doesn't carry.
      if (!notesRef.current.some(n => n.id === row.id)) return refresh()
      setNotes(prev =>
        prev.map(n =>
          n.id === row.id
            ? {
                ...n,
                title: row.title,
                content: row.content,
                mode: row.mode,
                updated_at: row.updated_at,
                space: n.user_id === userId ? row.space : n.space,
              }
            : n,
        ),
      )
    }

    supabase.realtime
      .setAuth()
      .catch(console.error)
      .then(() => {
        if (!live) return
        channel = supabase
          .channel(`user:${userId}`, { config: { private: true } })
          .on('broadcast', { event: 'note' }, ({ payload }) => patch(payload as NoteFields))
          .on('broadcast', { event: 'note_gone' }, ({ payload }) => {
            const { id } = payload as { id: string }
            // An undone delete is on its way back.
            if (!outbox.pendingFor(id)) setNotes(prev => prev.filter(n => n.id !== id))
          })
          .on('broadcast', { event: 'refresh' }, refresh)
          .on('broadcast', { event: 'friends' }, () => loadFriends())
          .subscribe(status => {
            if (status !== 'SUBSCRIBED') return
            // Back after a dropped connection: catch up on whatever was missed.
            if (joined) refresh()
            joined = true
          })
      })

    return () => {
      live = false
      window.clearTimeout(timer)
      if (channel) supabase.removeChannel(channel)
    }
  }, [userId, load, loadFriends, outbox])

  // Keep the device's copy in step with the desk.
  useEffect(() => {
    if (!snapshotRead.current) return
    saveSnapshot(userId, { notes, labels, friendships }).catch(console.error)
  }, [userId, notes, labels, friendships])

  const saveNote = useCallback(
    (draft: NoteDraft) => {
      const now = new Date().toISOString()
      const existing = notesRef.current.find(n => n.id === draft.id)
      setNotes(prev => {
        const i = prev.findIndex(n => n.id === draft.id)
        if (i === -1) return [{ ...draft, user_id: userId, labelIds: [], shares: [], created_at: now, updated_at: now }, ...prev]
        const next = [...prev]
        next[i] = { ...next[i], ...draft, updated_at: now }
        return next
      })
      const { id, title, content, mode, space } = draft
      if (existing && existing.user_id !== userId) outbox.push({ kind: 'updateNote', row: { id, title, content, mode } })
      else outbox.push({ kind: 'upsertNote', row: { id, title, content, mode, space } })
    },
    [outbox, userId],
  )

  /**
   * Deletes immediately and returns an undo function that restores the note, its labels and
   * its shares. For a note a friend shared, it only leaves it, which can't be undone.
   */
  const deleteNote = useCallback(
    (id: string) => {
      const note = notesRef.current.find(n => n.id === id)
      setNotes(prev => prev.filter(n => n.id !== id))
      if (note && note.user_id !== userId) {
        outbox.push({ kind: 'removeShare', noteId: id, userId })
        return null
      }
      outbox.push({ kind: 'deleteNote', id })
      return () => {
        if (!note) return
        setNotes(prev => [note, ...prev].sort((a, b) => b.created_at.localeCompare(a.created_at)))
        const { labelIds, shares, ...row } = note
        outbox.push({ kind: 'insertNote', row })
        if (labelIds.length) {
          outbox.push({ kind: 'insertNoteLabels', rows: labelIds.map(label_id => ({ note_id: id, label_id })) })
        }
        if (shares.length) {
          outbox.push({ kind: 'insertShares', rows: shares.map(user_id => ({ note_id: id, user_id, space: note.space })) })
        }
      }
    },
    [outbox, userId],
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

  /**
   * Shares one of this person's notes with a friend, or stops sharing it. The friend finds it in
   * the same space it's in here, so a work note stays among their work notes.
   */
  const shareNote = useCallback(
    (noteId: string, space: Space, friendId: string, on: boolean) => {
      // (The note may have been saved a moment ago and not be on the desk yet; this queues behind that.)
      setNotes(prev =>
        prev.map(n => {
          if (n.id !== noteId) return n
          const rest = n.shares.filter(s => s !== friendId)
          return { ...n, shares: on ? [...rest, friendId] : rest }
        }),
      )
      outbox.push(
        on
          ? { kind: 'insertShares', rows: [{ note_id: noteId, user_id: friendId, space }] }
          : { kind: 'removeShare', noteId, userId: friendId },
      )
    },
    [outbox],
  )

  const createLabel = useCallback(
    async (rawName: string, space: Space): Promise<Label | null> => {
      const name = rawName.trim().slice(0, 50)
      if (!name) return null
      const existing = labels.find(l => l.space === space && l.name.toLowerCase() === name.toLowerCase())
      if (existing) return existing
      // No need to wait for the server: the outbox sends this before any note is filed under it.
      const label = { id: uuid(), name, space }
      setLabels(prev => [...prev, label].sort(byName))
      outbox.push({ kind: 'insertLabel', label })
      return label
    },
    [labels, outbox],
  )

  const renameLabel = useCallback(
    (id: string, rawName: string) => {
      const name = rawName.trim().slice(0, 50)
      const label = labels.find(l => l.id === id)
      if (!name || !label) return
      if (labels.some(l => l.id !== id && l.space === label.space && l.name.toLowerCase() === name.toLowerCase())) return
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

  // Friends need the server there and then (the other person has to see it), so these don't
  // go through the outbox.
  const friends = useMemo(() => friendships.map(toFriend(userId)), [friendships, userId])

  const friendFailed = useCallback((error: unknown, message = 'Couldn’t reach the server. Check your connection.') => {
    console.error(error)
    onErrorRef.current(message)
    return false
  }, [])

  const answerFriend = useCallback(
    async (id: string, accept: boolean, rawName = '') => {
      const { error } = await supabase
        .from('friendships')
        .update({ status: accept ? 'accepted' : 'declined', addressee_alias: rawName.trim().slice(0, 60) })
        .eq('id', id)
      if (error) return friendFailed(error)
      await loadFriends()
      return true
    },
    [friendFailed, loadFriends],
  )

  /** Asks someone to be friends, by email. If they've already asked, accepts instead. */
  const addFriend = useCallback(
    async (rawEmail: string, rawName: string): Promise<boolean> => {
      const email = rawEmail.trim().toLowerCase()
      const name = rawName.trim().slice(0, 60)
      const known = friendshipsRef.current.map(toFriend(userId)).find(f => f.email === email)
      if (known?.incoming && known.status === 'pending') return answerFriend(known.id, true, name)
      if (known && known.status !== 'declined') {
        onErrorRef.current(known.status === 'accepted' ? 'You’re already friends.' : 'You’ve already asked them.')
        return false
      }
      // They turned down an earlier request; this one starts afresh.
      if (known && !known.incoming) {
        const { error } = await supabase.from('friendships').delete().eq('id', known.id)
        if (error) return friendFailed(error)
      }
      const { error } = await supabase.from('friendships').insert({ addressee_email: email, requester_alias: name })
      if (error) return friendFailed(error, /yourself/.test(error.message) ? 'That’s your own address.' : undefined)
      await loadFriends()
      return true
    },
    [userId, answerFriend, friendFailed, loadFriends],
  )

  const renameFriend = useCallback(
    async (id: string, rawName: string) => {
      const name = rawName.trim().slice(0, 60)
      const row = friendshipsRef.current.find(f => f.id === id)
      if (!row) return
      const field = row.requester_id === userId ? 'requester_alias' : 'addressee_alias'
      setFriendships(prev => prev.map(f => (f.id === id ? { ...f, [field]: name } : f)))
      const { error } = await supabase.from('friendships').update({ [field]: name }).eq('id', id)
      if (error) {
        friendFailed(error)
        loadFriends()
      }
    },
    [userId, friendFailed, loadFriends],
  )

  /** Cancels a request, or ends a friendship (which also ends sharing between the two). */
  const removeFriend = useCallback(
    async (id: string) => {
      setFriendships(prev => prev.filter(f => f.id !== id))
      const { error } = await supabase.from('friendships').delete().eq('id', id)
      if (error) {
        friendFailed(error)
        loadFriends()
      }
    },
    [friendFailed, loadFriends],
  )

  return {
    notes,
    labels,
    friends,
    loading,
    /** Writes not yet on the server. */
    pending,
    /** No connection, or writes are failing for want of one. */
    offline: !online || stalled,
    saveNote,
    deleteNote,
    toggleNoteLabel,
    shareNote,
    createLabel,
    renameLabel,
    deleteLabel,
    addFriend,
    answerFriend,
    renameFriend,
    removeFriend,
  }
}
