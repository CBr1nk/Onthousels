import type { JSONContent } from '@tiptap/react'

export type NoteMode = 'text' | 'checklist'

/** Personal and Work keep separate notes, labels and to-do lists. */
export type Space = 'personal' | 'work'

export interface Note {
  id: string
  /** The owner. Anyone else is reading it because it was shared with them. */
  user_id: string
  title: string
  content: JSONContent
  mode: NoteMode
  /** Where it sits on this person's desk (for a shared note, where they keep their copy). */
  space: Space
  created_at: string
  updated_at: string
  labelIds: string[]
  /** For the owner: the friends it's shared with. Empty for everyone else. */
  shares: string[]
}

export interface NoteDraft {
  id: string
  title: string
  content: JSONContent
  mode: NoteMode
  space: Space
}

export interface Label {
  id: string
  name: string
  space: Space
}

export type FriendStatus = 'pending' | 'accepted' | 'declined'

/** A friendship row, as both sides see it. */
export interface FriendshipRow {
  id: string
  requester_id: string
  requester_email: string
  addressee_email: string
  addressee_id: string | null
  status: FriendStatus
  requester_alias: string
  addressee_alias: string
  created_at: string
}

/** A friendship from this person's side. */
export interface Friend {
  id: string
  /** Known once they've accepted (or, for a request they sent, straight away). */
  userId: string | null
  email: string
  /** What this person calls them; may be blank. */
  name: string
  status: FriendStatus
  /** They asked, rather than this person. */
  incoming: boolean
}
