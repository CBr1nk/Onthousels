import type { JSONContent } from '@tiptap/react'

export type NoteMode = 'text' | 'checklist'

export interface Note {
  id: string
  title: string
  content: JSONContent
  mode: NoteMode
  created_at: string
  updated_at: string
  labelIds: string[]
}

export interface NoteDraft {
  id: string
  title: string
  content: JSONContent
  mode: NoteMode
}

export interface Label {
  id: string
  name: string
}
