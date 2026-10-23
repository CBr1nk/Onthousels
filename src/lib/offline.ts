import type { User } from '@supabase/supabase-js'
import { createStore, del, get, set } from 'idb-keyval'
import type { FriendshipRow, Label, Note } from './types'

// Everything kept on the device so the desk opens, and can be written on, without a signal.
const db = createStore('onthousels', 'offline')

export interface Snapshot {
  notes: Note[]
  labels: Label[]
  /** Missing from copies saved before friends existed. */
  friendships?: FriendshipRow[]
}

export const loadSnapshot = (userId: string) => get<Snapshot>(`snapshot:${userId}`, db)
export const saveSnapshot = (userId: string, snapshot: Snapshot) => set(`snapshot:${userId}`, snapshot, db)

export const loadOutbox = <T>(userId: string) => get<T[]>(`outbox:${userId}`, db).then(ops => ops ?? [])
export const saveOutbox = <T>(userId: string, ops: T[]) => set(`outbox:${userId}`, ops, db)

export async function clearOffline(userId: string) {
  forgetUser()
  await Promise.all([del(`snapshot:${userId}`, db), del(`outbox:${userId}`, db)])
}

/** Ask the browser not to evict our copy when space runs low. */
export function keepStorage() {
  navigator.storage?.persist?.().catch(() => {})
}

// The last person signed in, so the app can open for them while it can't reach Supabase
// to refresh an expired session.
const USER_KEY = 'onthousels-user'

export function rememberUser(user: User) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify({ id: user.id, email: user.email, user_metadata: user.user_metadata }))
  } catch {}
}

export function recallUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    const { id, email, user_metadata } = JSON.parse(raw)
    return { id, email, user_metadata: user_metadata ?? {}, app_metadata: {}, aud: 'authenticated', created_at: '' }
  } catch {
    return null
  }
}

function forgetUser() {
  try {
    localStorage.removeItem(USER_KEY)
  } catch {}
}
