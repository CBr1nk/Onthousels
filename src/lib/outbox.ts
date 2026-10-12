import { loadOutbox, saveOutbox } from './offline'
import { supabase } from './supabase'
import type { Label, Note, NoteDraft } from './types'

/** A write waiting to reach Supabase. Plain data, so it survives on the device until it's sent. */
export type Op =
  | { kind: 'upsertNote'; row: NoteDraft }
  | { kind: 'deleteNote'; id: string }
  | { kind: 'insertNote'; row: Omit<Note, 'labelIds'> }
  | { kind: 'insertNoteLabels'; rows: { note_id: string; label_id: string }[] }
  | { kind: 'insertLabel'; label: Label }
  | { kind: 'updateLabel'; id: string; name: string }
  | { kind: 'deleteLabel'; id: string }
  | { kind: 'addNoteLabel'; noteId: string; labelId: string }
  | { kind: 'removeNoteLabel'; noteId: string; labelId: string }

function send(op: Op) {
  switch (op.kind) {
    case 'upsertNote':
      return supabase.from('notes').upsert(op.row)
    case 'deleteNote':
      return supabase.from('notes').delete().eq('id', op.id)
    // Inserts ignore duplicates so a retry after a lost reply doesn't fail.
    case 'insertNote':
      return supabase.from('notes').upsert(op.row, { ignoreDuplicates: true })
    case 'insertNoteLabels':
      return supabase.from('note_labels').upsert(op.rows, { ignoreDuplicates: true })
    case 'insertLabel':
      return supabase.from('labels').upsert(op.label, { ignoreDuplicates: true })
    case 'updateLabel':
      return supabase.from('labels').update({ name: op.name }).eq('id', op.id)
    case 'deleteLabel':
      return supabase.from('labels').delete().eq('id', op.id)
    case 'addNoteLabel':
      return supabase.from('note_labels').upsert({ note_id: op.noteId, label_id: op.labelId }, { ignoreDuplicates: true })
    case 'removeNoteLabel':
      return supabase.from('note_labels').delete().match({ note_id: op.noteId, label_id: op.labelId })
  }
}

const noteOf = (op: Op) =>
  op.kind === 'upsertNote' || op.kind === 'insertNote' ? op.row.id : op.kind === 'deleteNote' ? op.id : null

// No connection (0), an expired session still waiting to refresh (401), or a server
// having a moment. Anything else is a real rejection that retrying won't fix.
const retryable = (status: number) => status === 0 || status === 401 || status === 408 || status === 429 || status >= 500

export interface OutboxEvents {
  /** Pending count changed, or sending started or stopped failing for want of a connection. */
  onChange: (pending: number, stalled: boolean) => void
  /** Supabase refused a write outright; it has been dropped. */
  onRejected: () => void
}

/**
 * Writes are kept on the device and sent one at a time, in order, so a slow autosave
 * can never land after a newer one. Without a connection they wait and retry.
 */
export function createOutbox(userId: string, events: OutboxEvents) {
  let ops: Op[] = []
  let inFlight: Op | null = null
  let stalled = false
  let draining: Promise<boolean> | null = null
  let retryTimer: number | undefined
  let backoff = 0
  let pushes = 0

  // Writes made before the saved outbox has loaded go after the saved ones.
  const ready = loadOutbox<Op>(userId)
    .then(saved => {
      ops = [...saved, ...ops]
    })
    .catch(console.error)
    .then(() => notify())

  const notify = () => events.onChange(ops.length, stalled)
  const persist = () => ready.then(() => saveOutbox(userId, ops)).catch(console.error)

  const scheduleRetry = () => {
    window.clearTimeout(retryTimer)
    backoff = Math.min(backoff ? backoff * 2 : 5000, 60000)
    retryTimer = window.setTimeout(flush, backoff)
  }

  async function drain(): Promise<boolean> {
    await ready
    while (ops.length) {
      const op = ops[0]
      inFlight = op
      let status = 0
      let error: unknown = null
      try {
        ;({ status, error } = await send(op))
      } catch (e) {
        error = e
      }
      inFlight = null
      if (error && (retryable(status) || !navigator.onLine)) {
        stalled = true
        notify()
        scheduleRetry()
        return false
      }
      ops = ops.filter(o => o !== op)
      if (error) {
        console.error(error)
        events.onRejected()
      }
      stalled = false
      backoff = 0
      persist()
      notify()
    }
    return true
  }

  /** Sends what's waiting. Resolves true once nothing is left to send. */
  function flush(): Promise<boolean> {
    window.clearTimeout(retryTimer)
    draining ??= drain().finally(() => (draining = null))
    return draining
  }

  function push(op: Op) {
    pushes++
    // Autosave rewrites a note every pause; while it waits, keep only the newest copy.
    // The copy stays where the first one was, ahead of anything that needs the note to exist.
    const id = op.kind === 'upsertNote' ? op.row.id : null
    let replaced = false
    if (id) {
      for (let i = ops.length - 1; i >= 0; i--) {
        const o = ops[i]
        if (noteOf(o) !== id) continue
        if (o.kind === 'upsertNote' && o !== inFlight) {
          ops[i] = op
          replaced = true
        }
        break
      }
    }
    if (!replaced) ops.push(op)
    persist()
    notify()
    // Offline, leave it to the retry timer rather than trying on every keystroke pause.
    if (!stalled || navigator.onLine) flush()
  }

  return {
    push,
    flush,
    /** Bumps on every write, so a fetch can tell whether it raced one. */
    pushes: () => pushes,
    pending: () => ops.length,
    dispose: () => window.clearTimeout(retryTimer),
  }
}

export type Outbox = ReturnType<typeof createOutbox>
