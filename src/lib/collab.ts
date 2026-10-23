import type { RealtimeChannel } from '@supabase/supabase-js'
import { getSchema, type Extensions, type JSONContent } from '@tiptap/react'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates, type Awareness } from 'y-protocols/awareness'
import { hashId } from './doc'
import { supabase } from './supabase'
import type { NoteMode } from './types'

/*
 * Editing a note together.
 *
 * While a note is open, the editor works on a Yjs document: the title as text, the body as one
 * fragment per mode, and the current mode. Friends with the same note open swap changes over a
 * private Realtime channel ("note:<id>"), so both see each other's typing as it happens and
 * nothing is lost when they type at once. The note itself is still saved as plain JSON, as before.
 *
 * Whoever opens the note first builds the document from the saved note. Anyone joining later
 * takes the document from someone already there rather than building their own, since two
 * documents built separately would each bring a copy of the text.
 */

/** Changes that came from a friend, so they aren't sent back out. */
const REMOTE = 'remote'
/** The document being built from the saved note. */
export const SEED = 'seed'

export interface NoteState {
  title: string
  content: JSONContent
  mode: NoteMode
}

export const meta = (doc: Y.Doc) => doc.getMap<NoteMode>('meta')
export const titleText = (doc: Y.Doc) => doc.getText('title')

/** Sorted-key JSON, so the same note reads the same however its keys happened to be ordered. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

/**
 * Builds the document from the saved note. It's built under an id taken from the note's own
 * contents, so two people who happen to open the same note at the same moment build identical
 * documents, and Yjs merges them into one rather than doubling the text.
 */
export function seed(doc: Y.Doc, note: NoteState, extensions: Extensions) {
  const base = new Y.Doc()
  base.clientID = hashId(canonical(note))
  base.transact(() => {
    meta(base).set('mode', note.mode)
    titleText(base).insert(0, note.title)
    prosemirrorJSONToYXmlFragment(getSchema(extensions), note.content, base.getXmlFragment(note.mode))
  })
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(base), SEED)
  base.destroy()
}

/** Replaces the body of one mode, e.g. after converting text to a checklist. */
export function writeBody(doc: Y.Doc, mode: NoteMode, content: JSONContent, extensions: Extensions) {
  doc.transact(() => {
    prosemirrorJSONToYXmlFragment(getSchema(extensions), content, doc.getXmlFragment(mode))
    meta(doc).set('mode', mode)
  })
}

/** Rewrites a Y.Text to match `next`, touching only the part that changed. */
export function setText(text: Y.Text, next: string) {
  const prev = text.toString()
  if (prev === next) return
  let start = 0
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++
  let end = 0
  while (end < prev.length - start && end < next.length - start && prev[prev.length - 1 - end] === next[next.length - 1 - end]) end++
  text.doc!.transact(() => {
    text.delete(start, prev.length - start - end)
    text.insert(start, next.slice(start, next.length - end))
  })
}

const toBase64 = (bytes: Uint8Array) => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
const fromBase64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

export interface Person {
  userId: string
  name: string
}

interface JoinOptions {
  noteId: string
  doc: Y.Doc
  awareness: Awareness
  me: Person
  /** The document has content (built from the note, or taken from a friend). */
  isReady: () => boolean
  /** Nobody to take the document from (or no connection): build it from the saved note. */
  onAlone: () => void
  /** Took the document from a friend who had it open. */
  onSynced: () => void
  /** Who else has the note open right now. */
  onPeers: (people: Person[]) => void
}

/**
 * How long to wait for the channel to open, and then for a friend's copy, before going it alone.
 * Going alone too early while a friend is there would leave two copies of the text.
 */
const CHANNEL_PATIENCE = 6000
const PEER_PATIENCE = 2500

/** Opens the note's channel. Returns a function that leaves it. */
export function joinNote({ noteId, doc, awareness, me, isReady, onAlone, onSynced, onPeers }: JoinOptions) {
  let channel: RealtimeChannel | null = null
  let left = false
  let decided = false
  let timer: number | undefined

  const send = (event: string, payload: Record<string, unknown>) => {
    channel?.send({ type: 'broadcast', event, payload }).catch(console.error)
  }
  const sendAwareness = (clients = [doc.clientID]) => send('awareness', { u: toBase64(encodeAwarenessUpdate(awareness, clients)) })
  // Ask whoever's there for what we don't have. `reply` stops the answer from asking back forever.
  const ask = (reply: boolean) => send('sync1', { sv: toBase64(Y.encodeStateVector(doc)), reply })

  const goAlone = () => {
    window.clearTimeout(timer)
    if (!isReady()) onAlone()
  }

  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) send('update', { u: toBase64(update) })
  }
  const onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === 'local') sendAwareness([...added, ...updated, ...removed])
  }
  doc.on('update', onUpdate)
  awareness.on('update', onAwareness)

  // Offline, or the channel won't open: carry on alone, saving the usual way.
  timer = window.setTimeout(goAlone, navigator.onLine ? CHANNEL_PATIENCE : 0)

  supabase.realtime
    .setAuth()
    .catch(console.error)
    .then(() => {
      if (left) return
      const ch = supabase.channel(`note:${noteId}`, { config: { private: true, presence: { key: String(doc.clientID) } } })
      channel = ch
      ch.on('broadcast', { event: 'sync1' }, ({ payload }) => {
        // Not ready means an empty document, which would be no help to anyone.
        if (!isReady()) return
        send('sync2', { u: toBase64(Y.encodeStateAsUpdate(doc, fromBase64(payload.sv))) })
        sendAwareness()
        if (!payload.reply) ask(true)
      })
        .on('broadcast', { event: 'sync2' }, ({ payload }) => {
          Y.applyUpdate(doc, fromBase64(payload.u), REMOTE)
          if (!isReady()) {
            window.clearTimeout(timer)
            onSynced()
          }
        })
        .on('broadcast', { event: 'update' }, ({ payload }) => Y.applyUpdate(doc, fromBase64(payload.u), REMOTE))
        .on('broadcast', { event: 'awareness' }, ({ payload }) => applyAwarenessUpdate(awareness, fromBase64(payload.u), REMOTE))
        .on('presence', { event: 'sync' }, () => {
          const others = Object.entries(ch.presenceState<Person>()).filter(([key]) => key !== String(doc.clientID))
          const people = new Map<string, Person>()
          for (const [, [p]] of others) if (p && p.userId !== me.userId) people.set(p.userId, { userId: p.userId, name: p.name })
          onPeers([...people.values()])
          if (decided) return
          decided = true
          if (isReady()) return
          // Someone has it open: take their copy. Otherwise build it from the saved note.
          if (others.length) {
            ask(false)
            window.clearTimeout(timer)
            timer = window.setTimeout(goAlone, PEER_PATIENCE)
          } else {
            goAlone()
          }
        })
        .on('presence', { event: 'leave' }, ({ key }) => removeAwarenessStates(awareness, [Number(key)], REMOTE))
        .subscribe(status => {
          if (status === 'SUBSCRIBED') {
            ch.track(me).catch(console.error)
            // Already had the document (opened alone, or back after a dropped connection):
            // swap whatever either side missed.
            if (isReady()) {
              ask(false)
              sendAwareness()
            }
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            goAlone()
          }
        })
    })

  return () => {
    left = true
    window.clearTimeout(timer)
    doc.off('update', onUpdate)
    awareness.off('update', onAwareness)
    if (channel) supabase.removeChannel(channel)
    onPeers([])
  }
}
