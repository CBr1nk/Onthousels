import type { Space } from './types'

// crypto.randomUUID only exists in secure contexts (HTTPS or localhost), so a phone
// opening the dev server over the LAN needs the getRandomValues fallback.
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * The id of a person's pinned to-do list in a space. It's derived from their own id (each hex
 * digit flipped for Personal, shifted by 8 for Work), so every device finds the same note without
 * asking the server, and an offline first edit can't create a second list. supabase/schema.sql
 * makes the same derivation to keep these lists from being shared.
 */
export function pinnedTodoId(userId: string, space: Space = 'personal'): string {
  const shift = space === 'work' ? (d: number) => (d + 8) % 16 : (d: number) => 15 - d
  return userId.replace(/[0-9a-f]/gi, c => shift(parseInt(c, 16)).toString(16))
}
